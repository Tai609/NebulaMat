#!/usr/bin/env python3
"""
Feishu Bridge Server — provides HTTP API for ARIS skills to send messages
to Feishu and poll for user replies.

Endpoints:
  POST /send   — send a card message to Feishu user, return message_id
  GET  /poll    — wait for user reply (long-poll with timeout)
  GET  /health  — health check

Requires:
  pip install lark-oapi

Environment variables:
  FEISHU_APP_ID      — Feishu app ID
  FEISHU_APP_SECRET  — Feishu app secret
  FEISHU_USER_ID     — Target user's open_id (who receives notifications)
  BRIDGE_PORT        — HTTP port (default: 5000)
"""

import os
import sys
import json
import time
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

try:
    import lark_oapi as lark
    from lark_oapi.api.im.v1 import (
        CreateMessageRequest, CreateMessageRequestBody,
    )
except ImportError:
    print("Error: lark-oapi not installed. Run: pip install lark-oapi", file=sys.stderr)
    sys.exit(1)

# --- Configuration ---
APP_ID = os.environ.get("FEISHU_APP_ID", "")
APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")
USER_ID = os.environ.get("FEISHU_USER_ID", "")
PORT = int(os.environ.get("BRIDGE_PORT", "5000"))

if not APP_ID or not APP_SECRET:
    print("Error: FEISHU_APP_ID and FEISHU_APP_SECRET are required", file=sys.stderr)
    sys.exit(1)

if not USER_ID:
    print("Warning: FEISHU_USER_ID not set — /send will require user_id in request body", file=sys.stderr)

# --- Lark Client ---
client = lark.Client.builder().app_id(APP_ID).app_secret(APP_SECRET).build()

# --- Reply Store (thread-safe) ---
reply_store = {}
reply_lock = threading.Lock()
reply_events = {}


def send_card(user_id: str, title: str, body: str, color: str = "blue") -> dict:
    """Send an interactive card to a Feishu user."""
    card = json.dumps({
        "header": {
            "title": {"tag": "plain_text", "content": title},
            "template": color,
        },
        "elements": [
            {"tag": "markdown", "content": body}
        ]
    })

    request = CreateMessageRequest.builder() \
        .receive_id_type("open_id") \
        .request_body(
            CreateMessageRequestBody.builder()
            .receive_id(user_id)
            .msg_type("interactive")
            .content(card)
            .build()
        ).build()

    response = client.im.v1.message.create(request)

    if not response.success():
        return {"error": response.msg, "code": response.code}

    msg_id = response.data.message_id
    # Prepare reply event for this message
    with reply_lock:
        reply_events[msg_id] = threading.Event()
        reply_store[msg_id] = None

    return {"ok": True, "message_id": msg_id}


def send_text(user_id: str, text: str) -> dict:
    """Send a plain text message to a Feishu user."""
    request = CreateMessageRequest.builder() \
        .receive_id_type("open_id") \
        .request_body(
            CreateMessageRequestBody.builder()
            .receive_id(user_id)
            .msg_type("text")
            .content(json.dumps({"text": text}))
            .build()
        ).build()

    response = client.im.v1.message.create(request)

    if not response.success():
        return {"error": response.msg, "code": response.code}

    return {"ok": True, "message_id": response.data.message_id}


def poll_reply(message_id: str, timeout: int = 300) -> dict:
    """Wait for a user reply to a specific message."""
    with reply_lock:
        event = reply_events.get(message_id)

    if not event:
        return {"error": "unknown message_id"}

    # Wait for reply or timeout
    got_reply = event.wait(timeout=timeout)

    with reply_lock:
        reply = reply_store.pop(message_id, None)
        reply_events.pop(message_id, None)

    if got_reply and reply:
        return {"reply": reply}
    else:
        return {"timeout": True}


def receive_reply(message_id: str, text: str):
    """Called when a user replies (webhook or external trigger)."""
    with reply_lock:
        if message_id in reply_store:
            reply_store[message_id] = text
            reply_events[message_id].set()


# --- HTTP Handler ---
class BridgeHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._json_response({"status": "ok", "port": PORT})
            return

        if self.path.startswith("/poll"):
            # Parse query params
            params = {}
            if "?" in self.path:
                query = self.path.split("?", 1)[1]
                for pair in query.split("&"):
                    if "=" in pair:
                        k, v = pair.split("=", 1)
                        params[k] = v

            message_id = params.get("message_id", "")
            timeout = int(params.get("timeout", "300"))

            if not message_id:
                self._json_response({"error": "message_id required"}, 400)
                return

            result = poll_reply(message_id, timeout)
            self._json_response(result)
            return

        self._json_response({"error": "not found"}, 404)

    def do_POST(self):
        if self.path == "/send":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length)) if content_length else {}

            user_id = body.get("user_id", USER_ID)
            if not user_id:
                self._json_response({"error": "user_id required (set FEISHU_USER_ID or pass in body)"}, 400)
                return

            msg_type = body.get("type", "card")
            title = body.get("title", "ARIS Notification")
            content = body.get("body", body.get("content", ""))
            color = body.get("color", "blue")

            if msg_type == "text":
                result = send_text(user_id, content)
            else:
                result = send_card(user_id, title, content, color)

            self._json_response(result)
            return

        if self.path == "/reply":
            # External hook: when user replies, call this endpoint
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length)) if content_length else {}

            message_id = body.get("message_id", "")
            text = body.get("text", "")

            if message_id:
                receive_reply(message_id, text)
                self._json_response({"ok": True})
            else:
                self._json_response({"error": "message_id required"}, 400)
            return

        self._json_response({"error": "not found"}, 404)

    def _json_response(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        # Quiet logging
        pass


def main():
    server = HTTPServer(("0.0.0.0", PORT), BridgeHandler)
    print(f"Feishu Bridge Server running on http://0.0.0.0:{PORT}")
    print(f"  POST /send   — send card/text to Feishu")
    print(f"  GET  /poll   — wait for user reply")
    print(f"  POST /reply  — receive user reply (webhook)")
    print(f"  GET  /health — health check")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
