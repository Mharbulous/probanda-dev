import json
import subprocess
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "calculate_contract_interest.py"


class ContractInterestCliTests(unittest.TestCase):
    maxDiff = None

    def run_cli(self, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *map(str, args)],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_legacy_fixed_output_is_byte_for_byte_stable(self):
        schedule = json.dumps([{"effective_date": "2024-01-01", "rate": 12}])
        result = self.run_cli(1000, "2024-01-01", "2024-01-31", schedule)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout,
            """Principal Amount: $1,000.00
Period: 2024-01-01 to 2024-01-31

Interest by Sub-Period:
--------------------------------------------------------------------------------
[2024-01-01 to 2024-01-31]
  Rate: 12.0000% per annum
  Days: 31 days
  Principal: $1,000.00
  Interest: $10.19
--------------------------------------------------------------------------------
Total Interest: $10.19
Principal + Interest: $1,010.19
""",
        )

    def test_legacy_floating_output_is_byte_for_byte_stable(self):
        schedule = json.dumps(
            [
                {"effective_date": "2024-01-01", "rate": 12},
                {"effective_date": "2024-01-16", "rate": 6},
            ]
        )
        result = self.run_cli(1000, "2024-01-01", "2024-01-31", schedule)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout,
            """Principal Amount: $1,000.00
Period: 2024-01-01 to 2024-01-31

Interest by Sub-Period:
--------------------------------------------------------------------------------
[2024-01-01 to 2024-01-15]
  Rate: 12.0000% per annum
  Days: 15 days
  Principal: $1,000.00
  Interest: $4.93
--------------------------------------------------------------------------------
[2024-01-16 to 2024-01-31]
  Rate: 6.0000% per annum
  Days: 16 days
  Principal: $1,000.00
  Interest: $2.63
--------------------------------------------------------------------------------
Total Interest: $7.56
Principal + Interest: $1,007.56
""",
        )

    def test_monthly_anniversary_rest_capitalizes_before_rest_date_interest(self):
        schedule = json.dumps([{"effective_date": "2024-01-15", "rate": 36.5}])
        result = self.run_cli(
            1000,
            "2024-01-15",
            "2024-02-15",
            schedule,
            "--compound",
            "monthly",
            "--first-rest-date",
            "2024-02-15",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Capitalization before 2024-02-15: $31.00", result.stdout)
        self.assertIn("Total Interest Accrued: $32.03", result.stdout)
        self.assertIn("Ending Balance: $1,032.03", result.stdout)

    def test_calendar_month_end_uses_next_month_first_as_rest_boundary(self):
        schedule = json.dumps([{"effective_date": "2024-01-15", "rate": 36.5}])
        result = self.run_cli(
            1000,
            "2024-01-15",
            "2024-02-01",
            schedule,
            "--compound",
            "monthly",
            "--first-rest-date",
            "2024-02-01",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Capitalization before 2024-02-01: $17.00", result.stdout)
        self.assertIn("Ending Balance: $1,018.02", result.stdout)

    def test_short_month_clamps_then_returns_to_anchor_day(self):
        schedule = json.dumps([{"effective_date": "2024-01-01", "rate": 36.5}])
        result = self.run_cli(
            1000,
            "2024-01-01",
            "2024-03-31",
            schedule,
            "--compound",
            "monthly",
            "--first-rest-date",
            "2024-01-31",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Capitalization before 2024-02-29", result.stdout)
        self.assertIn("Capitalization before 2024-03-31", result.stdout)
        self.assertIn("Ending Balance: $1,093.82", result.stdout)

    def test_rate_change_inside_rest_period_uses_new_rate_from_effective_date(self):
        schedule = json.dumps(
            [
                {"effective_date": "2024-01-01", "rate": 36.5},
                {"effective_date": "2024-01-16", "rate": 73},
            ]
        )
        result = self.run_cli(
            1000,
            "2024-01-01",
            "2024-02-01",
            schedule,
            "--compound",
            "monthly",
            "--first-rest-date",
            "2024-02-01",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Capitalization before 2024-02-01: $47.00", result.stdout)
        self.assertIn("Total Interest Accrued: $49.09", result.stdout)
        self.assertIn("Ending Balance: $1,049.09", result.stdout)

    def test_payment_applies_interest_first_at_start_of_day(self):
        schedule = json.dumps([{"effective_date": "2024-01-01", "rate": 36.5}])
        result = self.run_cli(
            1000,
            "2024-01-01",
            "2024-01-11",
            schedule,
            "--payment",
            "2024-01-11",
            "105",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Payment on 2024-01-11: $105.00", result.stdout)
        self.assertIn("Applied to uncapitalized interest: $10.00", result.stdout)
        self.assertIn("Applied to original principal: $95.00", result.stdout)
        self.assertIn("Total Interest Accrued: $10.91", result.stdout)
        self.assertIn("Ending Balance: $905.91", result.stdout)

    def test_same_day_events_are_rate_then_payment_then_rest_then_accrual(self):
        schedule = json.dumps(
            [
                {"effective_date": "2024-01-01", "rate": 36.5},
                {"effective_date": "2024-01-11", "rate": 73},
            ]
        )
        result = self.run_cli(
            1000,
            "2024-01-01",
            "2024-01-11",
            schedule,
            "--compound",
            "monthly",
            "--first-rest-date",
            "2024-01-11",
            "--payment",
            "2024-01-11",
            "15",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        rate = result.stdout.index("Rate effective 2024-01-11: 73%")
        payment = result.stdout.index("Payment on 2024-01-11: $15.00")
        rest = result.stdout.index("Capitalization before 2024-01-11: $0.00")
        accrual = result.stdout.index("Accrual [2024-01-11 to 2024-01-11]")
        self.assertLess(rate, payment)
        self.assertLess(payment, rest)
        self.assertLess(rest, accrual)
        self.assertIn("Ending Balance: $996.99", result.stdout)

    def test_multiple_same_day_payments_are_aggregated(self):
        schedule = json.dumps([{"effective_date": "2024-01-01", "rate": 36.5}])
        result = self.run_cli(
            1000,
            "2024-01-01",
            "2024-01-02",
            schedule,
            "--payment",
            "2024-01-02",
            "5",
            "--payment",
            "2024-01-02",
            "10",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.count("Payment on 2024-01-02: $15.00"), 1)

    def test_multiple_payments_on_distinct_dates_update_later_accruals(self):
        schedule = json.dumps([{"effective_date": "2024-01-01", "rate": 36.5}])
        result = self.run_cli(
            1000,
            "2024-01-01",
            "2024-01-11",
            schedule,
            "--payment",
            "2024-01-06",
            "105",
            "--payment",
            "2024-01-11",
            "100",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Payment on 2024-01-06: $105.00", result.stdout)
        self.assertIn("Payment on 2024-01-11: $100.00", result.stdout)
        self.assertIn("Total Payments: $205.00", result.stdout)
        self.assertIn("Ending Balance: $805.30", result.stdout)

    def test_event_ledger_reports_required_audit_fields(self):
        schedule = json.dumps([{"effective_date": "2024-01-01", "rate": 36.5}])
        result = self.run_cli(
            1000,
            "2024-01-01",
            "2024-02-01",
            schedule,
            "--compound",
            "monthly",
            "--first-rest-date",
            "2024-02-01",
            "--payment",
            "2024-01-16",
            "20",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        for field in (
            "Opening on 2024-01-01:",
            "Rate: 36.5% per annum",
            "Inclusive Days: 15 days",
            "Interest accrued:",
            "Applied to uncapitalized interest:",
            "Capitalization before 2024-02-01:",
            "Closing balance:",
            "Total Interest Accrued:",
            "Total Payments:",
            "Ending Balance:",
        ):
            with self.subTest(field=field):
                self.assertIn(field, result.stdout)
    def test_overpayment_is_rejected(self):
        schedule = json.dumps([{"effective_date": "2024-01-01", "rate": 36.5}])
        result = self.run_cli(
            1000,
            "2024-01-01",
            "2024-01-02",
            schedule,
            "--payment",
            "2024-01-02",
            "1002",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("payment exceeds outstanding balance", result.stdout.lower())

    def test_invalid_inputs_fail_closed(self):
        duplicate_schedule = json.dumps(
            [
                {"effective_date": "2024-01-01", "rate": 10},
                {"effective_date": "2024-01-01", "rate": 11},
            ]
        )
        cases = [
            (
                (1000, "2024-01-01", "2024-01-31", duplicate_schedule),
                "duplicate rate effective_date",
            ),
            (
                (1000, "2024-02-01", "2024-01-31", json.dumps([{"effective_date": "2024-01-01", "rate": 10}])),
                "end_date must be on or after start_date",
            ),
            (
                (
                    1000,
                    "2024-01-01",
                    "2024-01-31",
                    json.dumps([{"effective_date": "2024-01-01", "rate": 10}]),
                    "--payment",
                    "2024-02-01",
                    "10",
                ),
                "payment date must fall within",
            ),
            (
                (
                    1000,
                    "2024-01-01",
                    "2024-01-31",
                    json.dumps([{"effective_date": "2024-01-01", "rate": 10}]),
                    "--compound",
                    "monthly",
                ),
                "--first-rest-date is required",
            ),            (
                (
                    1000,
                    "2024-1-01",
                    "2024-01-31",
                    json.dumps([{"effective_date": "2024-01-01", "rate": 10}]),
                ),
                "date must use YYYY-MM-DD",
            ),
            (
                (
                    1000,
                    "2024-01-01",
                    "2024-01-31",
                    json.dumps([{"effective_date": "2024-02-01", "rate": 10}]),
                ),
                "No rate_schedule entry",
            ),
            (
                (
                    1000,
                    "2024-01-01",
                    "2024-01-31",
                    json.dumps([{"effective_date": "2024-01-01", "rate": 10}]),
                    "--payment",
                    "not-a-date",
                    "10",
                ),
                "--payment DATE must be YYYY-MM-DD",
            ),
            (
                (
                    1000,
                    "2024-01-01",
                    "2024-01-31",
                    json.dumps([{"effective_date": "2024-01-01", "rate": 10}]),
                    "--payment",
                    "2024-01-10",
                    "0",
                ),
                "--payment AMOUNT must be greater than zero",
            ),
        ]
        for args, message in cases:
            with self.subTest(message=message):
                result = self.run_cli(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message.lower(), result.stdout.lower())

    def test_period_can_end_before_first_monthly_rest(self):
        schedule = json.dumps([{"effective_date": "2024-01-01", "rate": 36.5}])
        result = self.run_cli(
            1000,
            "2024-01-01",
            "2024-01-10",
            schedule,
            "--compound",
            "monthly",
            "--first-rest-date",
            "2024-02-01",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("Capitalization before", result.stdout)
        self.assertIn("Total Interest Accrued: $10.00", result.stdout)
        self.assertIn("Ending Balance: $1,010.00", result.stdout)


if __name__ == "__main__":
    unittest.main()
