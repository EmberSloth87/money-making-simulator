"""
WSGI entry point for deploying Money Making Simulator behind any WSGI server.

The game runs entirely in the browser, so this app only serves the static files
(index.html, the learning guide learn.html, css/ and js/). It uses the Python standard library only.

    gunicorn wsgi:application              # Linux / macOS
    waitress-serve --port=8080 wsgi:application   # Windows or anywhere
    python3 wsgi.py                        # quick local test on http://localhost:8080

Environment variables (used by `python3 wsgi.py` only): HOST (default 127.0.0.1), PORT (default 8080).
"""
import hashlib
import mimetypes
import os
from email.utils import formatdate, parsedate_to_datetime

ROOT = os.path.dirname(os.path.realpath(__file__))
# Only these top-level entries are ever served: never server code, tests, .git, etc.
PUBLIC = {'index.html', 'learn.html', 'css', 'js'}
TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
}
SECURITY_HEADERS = [
    ('X-Content-Type-Options', 'nosniff'),
    ('Referrer-Policy', 'no-referrer'),
    ('X-Frame-Options', 'SAMEORIGIN'),
]


def _resolve(path_info):
    """Map a request path to a file inside ROOT, or None if it isn't public."""
    rel = path_info.lstrip('/') or 'index.html'
    if '\x00' in rel:
        return None
    full = os.path.realpath(os.path.join(ROOT, rel))
    if not full.startswith(ROOT + os.sep):
        return None
    top = os.path.relpath(full, ROOT).split(os.sep)[0]
    if top not in PUBLIC or not os.path.isfile(full):
        return None
    return full


def _plain(start_response, status, body, extra=()):
    data = body.encode('utf-8')
    start_response(status, [('Content-Type', 'text/plain; charset=utf-8'),
                            ('Content-Length', str(len(data)))] + list(extra) + SECURITY_HEADERS)
    return [data]


def application(environ, start_response):
    method = environ.get('REQUEST_METHOD', 'GET').upper()
    path_info = environ.get('PATH_INFO', '')
    # WSGI servers hand PATH_INFO over as latin-1-decoded bytes; turn it back into UTF-8 text.
    try:
        path_info = path_info.encode('latin-1').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return _plain(start_response, '400 Bad Request', 'Bad request')

    if path_info == '/healthz':
        return _plain(start_response, '200 OK', 'ok')

    # Mounted under a prefix (e.g. /game) with no trailing slash: redirect, so the page's
    # relative links to css/ and js/ resolve under the prefix.
    if path_info == '' and environ.get('SCRIPT_NAME'):
        location = environ['SCRIPT_NAME'] + '/'
        if environ.get('QUERY_STRING'):
            location += '?' + environ['QUERY_STRING']
        return _plain(start_response, '301 Moved Permanently', 'Moved', [('Location', location)])

    if method not in ('GET', 'HEAD'):
        return _plain(start_response, '405 Method Not Allowed', 'Method not allowed', [('Allow', 'GET, HEAD')])

    full = _resolve(path_info)
    if full is None:
        return _plain(start_response, '404 Not Found', 'Not found')

    stat = os.stat(full)
    etag = '"%s"' % hashlib.sha1(('%s-%s' % (stat.st_mtime_ns, stat.st_size)).encode()).hexdigest()[:16]
    headers = [
        ('Content-Type', TYPES.get(os.path.splitext(full)[1].lower())
         or mimetypes.guess_type(full)[0] or 'application/octet-stream'),
        # Browsers revalidate every load (cheap 304s), so players always get the latest version after a deploy.
        ('Cache-Control', 'no-cache'),
        ('ETag', etag),
        ('Last-Modified', formatdate(stat.st_mtime, usegmt=True)),
    ] + SECURITY_HEADERS

    if _not_modified(environ, etag, stat.st_mtime):
        start_response('304 Not Modified', [h for h in headers if h[0] != 'Content-Type'])
        return [b'']

    headers.append(('Content-Length', str(stat.st_size)))
    start_response('200 OK', headers)
    if method == 'HEAD':
        return [b'']
    f = open(full, 'rb')
    wrapper = environ.get('wsgi.file_wrapper')
    if wrapper:
        return wrapper(f, 64 * 1024)
    with f:
        return [f.read()]


def _not_modified(environ, etag, mtime):
    inm = environ.get('HTTP_IF_NONE_MATCH')
    if inm is not None:
        return etag in [t.strip() for t in inm.split(',')] or inm.strip() == '*'
    ims = environ.get('HTTP_IF_MODIFIED_SINCE')
    if ims:
        try:
            return int(mtime) <= parsedate_to_datetime(ims).timestamp()
        except (TypeError, ValueError, OverflowError):
            return False
    return False


# Some hosts look for `app` instead of `application`.
app = application


if __name__ == '__main__':
    from wsgiref.simple_server import make_server
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '8080'))
    with make_server(host, port, application) as httpd:
        print('Money Making Simulator is running at http://localhost:%d (Ctrl+C to stop)' % port)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
