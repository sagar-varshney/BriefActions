import io
import json
import unittest
from unittest.mock import patch
import web_bridge

class ErrorPrivacyTests(unittest.TestCase):
    def test_unexpected_exception_does_not_print_private_values(self):
        secret='private transcript / password / owner@example.test'
        output,errors=io.StringIO(),io.StringIO()
        with patch('web_bridge.handle',side_effect=RuntimeError(secret)),patch('sys.stdin',io.StringIO('{"operation":"config"}')),patch('sys.stdout',output),patch('sys.stderr',errors):
            web_bridge.main()
        self.assertEqual(json.loads(output.getvalue())['status'],500)
        self.assertNotIn(secret,output.getvalue()+errors.getvalue())

if __name__=='__main__':unittest.main()
