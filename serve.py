# python3 serve.py  ->  http://localhost:8000/   (fetch needs http, not file://)
import http.server, socketserver
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
with socketserver.TCPServer(('', 8000), H) as s: print('Elental on http://localhost:8000/'); s.serve_forever()
