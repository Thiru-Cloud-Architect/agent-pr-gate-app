"""Write site/data/org.json for the signed-in GitHub account.

Uses GITHUB_TOKEN. Stores finding titles and paths only, never file contents
or secret values.
"""

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scan import (  # noqa: E402
    RULES,
    added_text,
    dedupe,
    dependencies_in,
    dependency_finding,
    lower_than,
    osv_findings,
    pattern_findings,
)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site" / "data" / "org.json"
FIX = {
    "open-cidr": "Replace the open address with the smallest network that needs access.",
    "public-acl": "Stop offering this storage for public read.",
    "privileged": "Run the container without privileged mode.",
    "latest-tag": "Pin the image to a specific version.",
    "user-root": "Set a non-root USER in the image.",
    "github-pat": "Remove the token and rotate it.",
    "github-fine": "Remove the token and rotate it.",
    "aws-access-key": "Remove the key and rotate it.",
    "private-key": "Remove the key and rotate it.",
    "missing-test": "Add a test for this repository.",
}


def main():
    token = os.environ.get("GITHUB_TOKEN") or ""
    if not token:
        sys.stderr.write("GITHUB_TOKEN is required.\n")
        sys.exit(1)
    user = api(token, "/user")
    repos = api(token, "/user/repos?per_page=100&type=owner&sort=updated")
    scanned = []
    for repo in repos:
        scanned.append(scan_repo(token, repo))
    payload = {
        "account": user.get("login") or "",
        "scannedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "notScanned": [
            {
                "name": "Running application",
                "why": "This pass reads repository files. It does not open a deployed site.",
            },
            {
                "name": "Cloud account",
                "why": "This pass does not log in to AWS, Azure, or Google Cloud.",
            },
        ],
        "repos": scanned,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    sys.stdout.write(f"Wrote {OUT} ({len(scanned)} repositories)\n")


def scan_repo(token, repo):
    full = repo["full_name"]
    record = {
        "name": repo["name"],
        "fullName": full,
        "url": repo.get("html_url") or "",
        "private": bool(repo.get("private")),
        "findings": [],
        "error": "",
    }
    branch = (repo.get("default_branch") or "main")
    try:
        tree = api(token, f"/repos/{full}/git/trees/{branch}?recursive=1")
    except urllib.error.HTTPError as error:
        record["error"] = f"Could not list files (HTTP {error.code})."
        return record
    paths = [item["path"] for item in tree.get("tree") or [] if item.get("type") == "blob"]
    record["findings"].extend(practice_from_tree(paths))
    chosen = choose_paths(paths)
    files = []
    for path in chosen:
        try:
            text = file_text(token, full, path, branch)
        except urllib.error.HTTPError:
            continue
        if text is None:
            continue
        files.append({"filename": path, "content": text})
    record["findings"].extend(public_findings(scan_documents(files)))
    return record


def choose_paths(paths):
    ranked = [path for path in paths if interesting(path)]
    ranked.sort(key=rank)
    return ranked[:40]


def interesting(path):
    lowered = path.lower()
    if "node_modules/" in lowered or "/.git/" in lowered:
        return False
    base = lowered.rsplit("/", 1)[-1]
    if base == "dockerfile" or base.startswith("dockerfile."):
        return True
    if lowered.endswith((".tf", "requirements.txt")) or base == "package.json":
        return True
    if lowered.endswith(("values.yaml", "values.yml")):
        return True
    if "/prod/" in lowered and lowered.endswith((".yaml", ".yml")):
        return True
    if lowered.endswith((".py", ".js", ".ts", ".go")) and not is_test(lowered):
        return True
    return False


def rank(path):
    lowered = path.lower()
    if lowered.rsplit("/", 1)[-1].startswith("dockerfile"):
        return 0
    if lowered.endswith(".tf") or lowered.endswith("requirements.txt") or lowered.endswith("package.json"):
        return 1
    if lowered.endswith((".yaml", ".yml")):
        return 2
    return 3


def practice_from_tree(paths):
    sources = [path for path in paths if is_source(path)]
    tests = [path for path in paths if is_test(path.lower())]
    if not sources or tests:
        return []
    return [
        {
            "kind": "practice",
            "id": "missing-test",
            "title": "This repository has application code and no test file in the tree we read",
            "severity": "medium",
            "filename": sources[0],
            "fix": FIX["missing-test"],
        }
    ]


def is_source(path):
    lowered = path.lower()
    if is_test(lowered) or "node_modules/" in lowered:
        return False
    return lowered.endswith((".py", ".js", ".ts", ".go", ".java"))


def is_test(lowered):
    return "/test/" in lowered or "/tests/" in lowered or "/__tests__/" in lowered or ".test." in lowered or ".spec." in lowered


def file_text(token, full, path, branch):
    quoted = urllib.request.quote(path, safe="/")
    payload = api(token, f"/repos/{full}/contents/{quoted}?ref={branch}")
    if payload.get("encoding") != "base64" or not payload.get("content"):
        return None
    if int(payload.get("size") or 0) > 200_000:
        return None
    return base64.b64decode(payload["content"]).decode("utf-8", errors="replace")


def scan_documents(files):
    findings = []
    packages = []
    for file in files:
        filename = file["filename"]
        text = added_text(file)
        findings.extend(pattern_findings(filename, text, RULES["secrets"], "secret"))
        findings.extend(pattern_findings(filename, text, RULES["code"], "code"))
        findings.extend(pattern_findings(filename, text, RULES.get("infrastructure") or [], "infrastructure"))
        findings.extend(pattern_findings(filename, text, RULES.get("containers") or [], "container"))
        for dependency in dependencies_in(filename, text):
            packages.append((filename, dependency))
            for advisory in RULES["advisories"]:
                if (
                    advisory["ecosystem"] == dependency["ecosystem"]
                    and advisory["name"] == dependency["name"]
                    and lower_than(dependency["version"], advisory["below"])
                ):
                    findings.append(dependency_finding(filename, dependency, advisory))
    findings.extend(osv_findings(packages, findings))
    return dedupe(findings)


def public_findings(findings):
    public = []
    for finding in findings:
        public.append(
            {
                "kind": finding.get("kind") or "",
                "id": finding.get("id") or "",
                "title": finding.get("title") or "",
                "severity": finding.get("severity") or "",
                "filename": finding.get("filename") or "",
                "package": finding.get("package") or "",
                "version": finding.get("version") or "",
                "fix": FIX.get(finding.get("id") or "", finding.get("summary") or "Review this file before merge."),
            }
        )
    return public


def api(token, path):
    request = urllib.request.Request(
        "https://api.github.com" + path,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "veto-org-scan",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


if __name__ == "__main__":
    main()
