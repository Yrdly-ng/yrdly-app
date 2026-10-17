#!/usr/bin/env python3
"""Create missing Matt Pocock triage labels without changing existing labels."""
import argparse
import json
import subprocess

LABELS = {
    "needs-triage": ("FBCA04", "Maintainer needs to evaluate this issue"),
    "needs-info": ("D4C5F9", "Waiting on reporter for more information"),
    "ready-for-agent": ("0E8A16", "Fully specified and ready for an agent"),
    "ready-for-human": ("1D76DB", "Requires human implementation"),
    "wontfix": ("FFFFFF", "Will not be actioned"),
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", action="append", required=True,
                        choices=["Yrdly-ng/yrdly", "Yrdly-ng/yrdly-app", "Yrdly-ng/yrdly-mobile"])
    args = parser.parse_args()
    subprocess.run(["gh", "auth", "status", "--hostname", "github.com"], check=True)
    for repo in dict.fromkeys(args.repo):
        result = subprocess.run(["gh", "label", "list", "--repo", repo,
                                 "--limit", "1000", "--json", "name"],
                                capture_output=True, text=True, check=True)
        existing = {label["name"] for label in json.loads(result.stdout)}
        for name, (color, description) in LABELS.items():
            if name in existing:
                print(f"{repo}: {name} already exists")
                continue
            subprocess.run(["gh", "label", "create", name, "--repo", repo,
                            "--color", color, "--description", description], check=True)
            print(f"{repo}: created {name}")

if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.returncode)
