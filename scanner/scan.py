"""Scan a pull request diff for secrets, dangerous calls, and known-bad packages.

Reads a JSON object on stdin: {"files": [{"filename", "patch", "content"}]}.
Writes findings JSON on stdout. Matched secret values are never printed.
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

RULES = json.loads((Path(__file__).with_name("rules.json")).read_text(encoding="utf-8"))


def main():
    payload = json.load(sys.stdin)
    files = payload.get("files") or []
    findings = []
    packages = []
    for file in files:
        filename = str(file.get("filename") or "")
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
    json.dump({"findings": dedupe(findings)}, sys.stdout)


def added_text(file):
    if file.get("content"):
        return str(file["content"])
    lines = []
    for line in str(file.get("patch") or "").splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            lines.append(line[1:])
    return "\n".join(lines)


def pattern_findings(filename, text, patterns, kind):
    found = []
    for rule in patterns:
        if re.search(rule["pattern"], text):
            found.append(
                {
                    "kind": kind,
                    "id": rule["id"],
                    "title": rule["title"],
                    "severity": rule["severity"],
                    "filename": filename,
                }
            )
    return found


def dependencies_in(filename, text):
    found = []
    if filename.endswith("package.json"):
        for name, version in re.findall(r'"([@A-Za-z0-9/_.-]+)":\s*"(\d+\.\d+\.\d+)"', text):
            found.append({"ecosystem": "npm", "name": name, "version": version})
    if filename.endswith("requirements.txt"):
        for name, version in re.findall(r"^([A-Za-z0-9_.-]+)==(\d+\.\d+\.\d+)", text, re.M):
            found.append({"ecosystem": "PyPI", "name": name.lower(), "version": version})
    return found


def dependency_finding(filename, dependency, advisory):
    return {
        "kind": "dependency",
        "id": advisory["id"],
        "title": advisory["summary"],
        "summary": advisory["summary"],
        "severity": advisory["severity"],
        "filename": filename,
        "package": dependency["name"],
        "version": dependency["version"],
        "fixed": advisory.get("fixed") or "",
    }


def osv_findings(packages, existing):
    known = {item.get("id") for item in existing}
    covered = {
        (item.get("package"), item.get("filename"))
        for item in existing
        if item.get("kind") == "dependency"
    }
    found = []
    for filename, dependency in packages[:8]:
        if (dependency["name"], filename) in covered:
            continue
        for advisory in query_osv(dependency):
            if advisory["id"] in known:
                continue
            known.add(advisory["id"])
            found.append(
                {
                    "kind": "dependency",
                    "id": advisory["id"],
                    "title": advisory["summary"],
                    "summary": advisory["summary"],
                    "severity": advisory["severity"],
                    "filename": filename,
                    "package": dependency["name"],
                    "version": dependency["version"],
                    "fixed": "",
                }
            )
    return found


def query_osv(dependency):
    body = json.dumps(
        {"package": {"name": dependency["name"], "ecosystem": dependency["ecosystem"]}, "version": dependency["version"]}
    ).encode()
    request = urllib.request.Request(
        "https://api.osv.dev/v1/query",
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "agent-gate"},
    )
    try:
        with urllib.request.urlopen(request, timeout=6) as response:
            payload = json.loads(response.read().decode())
    except Exception:
        return []
    advisories = []
    for item in (payload.get("vulns") or [])[:3]:
        summary = str(item.get("summary") or "Known advisory. Upgrade the package.").split(". ")[0]
        if len(summary) > 180:
            summary = summary[:177] + "..."
        advisories.append({"id": item.get("id") or "OSV", "summary": summary, "severity": "high"})
    return advisories


def lower_than(version, below):
    left = [int(part) for part in version.split(".")]
    right = [int(part) for part in below.split(".")]
    for index in range(3):
        a = left[index] if index < len(left) else 0
        b = right[index] if index < len(right) else 0
        if a < b:
            return True
        if a > b:
            return False
    return False


def dedupe(findings):
    seen = set()
    unique = []
    for finding in findings:
        key = (finding.get("kind"), finding.get("id"), finding.get("filename"), finding.get("package"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(finding)
    return unique


if __name__ == "__main__":
    main()
