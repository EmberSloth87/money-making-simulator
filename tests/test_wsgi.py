"""Tests for the WSGI entry point. Run: python3 -m unittest discover -s tests"""
import os
import sys
import unittest
from wsgiref.util import setup_testing_defaults
from wsgiref.validate import validator

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import wsgi  # noqa: E402


def call(path, method='GET', **env):
    environ = {'PATH_INFO': path, 'REQUEST_METHOD': method, 'SCRIPT_NAME': ''}
    environ.update(env)
    setup_testing_defaults(environ)
    environ['PATH_INFO'] = path
    out = {}

    def start_response(status, headers, exc_info=None):
        out['status'] = status
        out['headers'] = dict(headers)
    # The validator checks the app follows the WSGI spec (PEP 3333) on every call.
    result = validator(wsgi.application)(environ, start_response)
    try:
        body = b''.join(result)
    finally:
        result.close()
    return int(out['status'].split()[0]), out['headers'], body


class WsgiTest(unittest.TestCase):
    def test_root_serves_the_game(self):
        status, headers, body = call('/')
        self.assertEqual(status, 200)
        self.assertTrue(headers['Content-Type'].startswith('text/html'))
        self.assertIn(b'js/trade.js', body)

    def test_scripts_and_styles_have_the_right_types(self):
        for path, kind in [('/js/engine.js', 'text/javascript'), ('/js/savings.js', 'text/javascript'), ('/css/styles.css', 'text/css'),
                           ('/index.html', 'text/html'), ('/learn.html', 'text/html')]:
            status, headers, body = call(path)
            self.assertEqual(status, 200, path)
            self.assertTrue(headers['Content-Type'].startswith(kind), path)
            self.assertEqual(int(headers['Content-Length']), len(body))
            self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')

    def test_private_files_and_traversal_are_hidden(self):
        for path in ['/wsgi.py', '/server.js', '/package.json', '/README.md', '/tests/test_wsgi.py', '/.git/config',
                     '/js/../wsgi.py', '/js/../../etc/passwd', '/css', '/js/', '/nope.js', '/%2e%2e/wsgi.py']:
            status, _, body = call(path)
            self.assertEqual(status, 404, path)
            self.assertEqual(body, b'Not found')

    def test_head_and_methods(self):
        status, headers, body = call('/js/ui.js', 'HEAD')
        self.assertEqual(status, 200)
        self.assertEqual(body, b'')
        self.assertGreater(int(headers['Content-Length']), 0)
        status, headers, _ = call('/', 'POST')
        self.assertEqual(status, 405)
        self.assertEqual(headers['Allow'], 'GET, HEAD')

    def test_conditional_get_returns_304(self):
        _, headers, _ = call('/js/core.js')
        status, _, body = call('/js/core.js', HTTP_IF_NONE_MATCH=headers['ETag'])
        self.assertEqual(status, 304)
        self.assertEqual(body, b'')
        status, _, _ = call('/js/core.js', HTTP_IF_MODIFIED_SINCE=headers['Last-Modified'])
        self.assertEqual(status, 304)
        status, _, _ = call('/js/core.js', HTTP_IF_NONE_MATCH='"stale"')
        self.assertEqual(status, 200)

    def test_mounted_under_a_prefix_redirects_to_trailing_slash(self):
        status, headers, _ = call('', SCRIPT_NAME='/game')
        self.assertEqual(status, 301)
        self.assertEqual(headers['Location'], '/game/')
        status, _, body = call('/', SCRIPT_NAME='/game')
        self.assertEqual(status, 200)
        self.assertIn(b'<html', body.lower())

    def test_health_check(self):
        status, _, body = call('/healthz')
        self.assertEqual((status, body), (200, b'ok'))


if __name__ == '__main__':
    unittest.main()
