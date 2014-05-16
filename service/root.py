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

import json, flask_config
from flask import Blueprint, request, redirect, make_response

root = Blueprint('root', __name__, static_folder=flask_config.STATIC_PATH)

@root.route('/autoplay')
def autoplay():
  manifest_url = request.args.get("mpd")
  experiment_id = request.args.get("experiment_id", None)
  disable_haves = request.args.get("disable_haves", None)
  playback_delay = request.args.get("playback_delay", None)
  video_quality = request.args.get("video_quality", None)
  audio_quality = request.args.get("audio_quality", None)
  disable_p2p = request.args.get("disable_p2p", None)
  max_partners = request.args.get("max_partners", None)

  url = '/demo/player.html'

  if disable_p2p is not None:
    url = '/player-no-p2p.html'

  url += '?autoplay=true&mpd=' + manifest_url

  if experiment_id is not None:
    url = url + "&experiment_id=" + experiment_id

  if disable_haves is not None:
    url = url + "&disable_haves=" + disable_haves

  if playback_delay is not None:
    url = url + "&playback_delay=" + playback_delay

  if video_quality is not None:
    url = url + "&video_quality=" + video_quality

  if audio_quality is not None:
    url = url + "&audio_quality=" + audio_quality

  if max_partners is not None:
    url = url + "&max_partners=" + max_partners

  resp = make_response(redirect(url))
  return resp

@root.route('/')
def index():
  return redirect("index.html")
