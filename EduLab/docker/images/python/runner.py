#!/usr/bin/env python3
"""runner.py — Test runner for EduLab lab submissions (ТЗ §7).

Executed by Result Service (Этап 3) via `docker exec` when student submits a lab.
Reads test definitions from stdin (JSON), runs them against student code,
and outputs results as JSON to stdout.
"""
import json
import subprocess
import sys
import os


def run_tests(tests_json: str) -> dict:
    """Run tests against student code in /workspace.

    Args:
        tests_json: JSON string with test definitions

    Returns:
        dict with grade, passed_tests, failed_tests, details
    """
    tests = json.loads(tests_json)
    results = []
    passed = 0
    failed = 0

    for test in tests:
        test_name = test.get("name", "unknown")
        test_input = test.get("input", "")
        expected_output = test.get("expected_output", "").strip()

        try:
            # Run student code with test input
            result = subprocess.run(
                ["python3", "/workspace/main.py"],
                input=test_input,
                capture_output=True,
                text=True,
                timeout=10,
                cwd="/workspace",
            )

            actual_output = result.stdout.strip()
            test_passed = actual_output == expected_output

            if test_passed:
                passed += 1
            else:
                failed += 1

            results.append({
                "test": test_name,
                "passed": test_passed,
                "expected": expected_output,
                "actual": actual_output,
                "stderr": result.stderr[:500] if result.stderr else "",
            })

        except subprocess.TimeoutExpired:
            failed += 1
            results.append({
                "test": test_name,
                "passed": False,
                "error": "Timeout (10 seconds exceeded)",
            })
        except Exception as e:
            failed += 1
            results.append({
                "test": test_name,
                "passed": False,
                "error": str(e),
            })

    total = passed + failed
    grade = int((passed / total) * 100) if total > 0 else 0

    return {
        "grade": grade,
        "passed_tests": passed,
        "failed_tests": failed,
        "details": results,
    }


if __name__ == "__main__":
    # Read tests from stdin
    tests_json = sys.stdin.read()
    if not tests_json.strip():
        print(json.dumps({"grade": 0, "passed_tests": 0, "failed_tests": 0, "details": []}))
        sys.exit(0)

    result = run_tests(tests_json)
    print(json.dumps(result, ensure_ascii=False))
