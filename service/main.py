# The copyright in this software is being made available under the BSD License, included below. This software may be subject to other third party and contributor rights, including patent rights, and no such rights are granted under this license.
#
# Copyright (c) 2014, Peerialism AB
# All rights reserved.
# 
# Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
# - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
# - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
# - Neither the name of the Digital Primates nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
# 
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

import sys, json, logging, os
from logging.handlers import RotatingFileHandler
from flask import Flask, request, abort, redirect, Blueprint, current_app
from flask_sockets import Sockets
from logging import Formatter

import hive, root

# define the flask app and websockets app
app = Flask(__name__)
app.register_blueprint(root.root, url_prefix="")

sockets = Sockets(app)

app.config.from_pyfile('flask_config.py')

if not os.path.exists("logs"):
  os.mkdir("logs")

file_handler = RotatingFileHandler('logs/hive-discovery.log', maxBytes=10000, backupCount=1)
file_handler.setLevel(logging.DEBUG)

file_handler.setFormatter(Formatter(
  "%(asctime)s %(levelname)s [%(module)s:%(lineno)d]: %(message)s"
))

app.logger.addHandler(file_handler)
print app.url_map

@sockets.route('/echo')
def echo_socket(ws):
  while True:
    message = ws.receive()
    ws.send(message)

# TODO: add authorization to the ws endpoint
@sockets.route('/hive')
def hive_socket(ws):
  app.logger.debug("Received a new websocket connection on /hive: %s", ws)

  is_open = True
  while is_open:
    message = ws.receive()

    if message is None:
      app.logger.debug("Message channel closed: %s", ws)
      is_open = False
      hive.disconnect(ws)
    else:
      event = json.loads(message)
      response = hive.dispatch(ws, hive.Event(event["name"], event["msg"], event["id"]))


