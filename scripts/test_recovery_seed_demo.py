import unittest

from recovery_seed_demo import validate_target


class TargetGuardTests(unittest.TestCase):
    def test_only_recovery_target(self):
        validate_target(
            "postgresql+asyncpg://u:p@127.0.0.1:57433/wardrobe_demo_recovered",
            "http://127.0.0.1:18083/api/v1",
        )

    def test_original_or_remote_targets_rejected(self):
        for url in (
            "postgresql+asyncpg://u:p@127.0.0.1:56433/wardrobe_test_remediation",
            "postgresql+asyncpg://u:p@remote:57433/wardrobe_demo_recovered",
            "postgresql+asyncpg://u:p@127.0.0.1:57433/production",
        ):
            with self.assertRaises(ValueError):
                validate_target(url, "http://127.0.0.1:18083/api/v1")

    def test_old_api_rejected(self):
        with self.assertRaises(ValueError):
            validate_target(
                "postgresql+asyncpg://u:p@127.0.0.1:57433/wardrobe_demo_recovered",
                "http://127.0.0.1:18081/api/v1",
            )


if __name__ == "__main__":
    unittest.main()
