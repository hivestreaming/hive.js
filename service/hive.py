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

import sys, random, json, logging
from datetime import datetime
from geventwebsocket.websocket import WebSocketError

logger = logging.getLogger(__name__)

mod = sys.modules[__name__]

#  registry of peers
peers = {}

# channels
channels = {}

# registry of connections
conns = {}

class AttrDict(dict):
  def __init__(self, *args, **kwargs):
    super(AttrDict, self).__init__(*args, **kwargs)
    self.__dict__ = self

class Event:
  # Name, Message, Message Id
  def __init__(self, name, msg, mid = None):
    self.name = name
    self.msg = AttrDict(msg)
    self.mid = mid

  def to_json(self):
    return {
      "name": self.name,
      "id": self.mid,
      "msg": self.msg 
    }

  def reply(self, reply_name, reply_msg):
    return Event(reply_name, reply_msg, self.mid)

def dispatch(conn, event):
  f = getattr(mod, 'handle_' + event.name)
  return f(conn, event)

# Channels are used for signaling, each peer can have several channels
class Channel:
  def __init__(self, label, offer, local_peer, candidates = []):
    self.label = label
    self.offer = offer
    self.local_ice_candidates = candidates
    self.local_peer = local_peer

    # this will get filled in when we get an answer on the channel
    self.remote_peer = None
    self.remote_ice_candidates = []

  def add_local_ice_candidates(self, candidates):
    self.local_ice_candidates = self.local_ice_candidates + candidates

  def add_remote_ice_candidates(self, candidates):
    self.remote_ice_candidates = self.remote_ice_candidates + candidates

  def to_local_json(self):
    return {
      "label": self.label,
      "offer": self.offer,
      "ice_candidates": self.local_ice_candidates
    }

  def to_remote_json(self):
    return {
      "label": self.label,
      "offer": self.offer,
      "ice_candidates": self.remote_ice_candidates
    }


# A peer has a guid, a connection id and an offer
# The offer is created by a peer when it registers
class Peer:
  def __init__(self, guid, conn):
    self.guid = guid
    self.channels = []
    # websocket connection
    self.conn = conn
    self.first_seen = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")

  def add_channel(self, chan):
    self.channels.append(chan)

  def to_json(self):
    return {
      "guid": self.guid,
      "first_seen": self.first_seen
    }

  def send(self, msg):
    logger.debug("Sending a message to %s, %s, %s", self.guid, msg.name, self.conn)
    try:
      self.conn.send(json.dumps(msg.to_json()))
    except WebSocketError,e:
      logger.warning("Error sending message, web socket is not available %s", e)
      disconnect(self.conn)

def handle_echo(conn, event):
  conn.send(json.dumps(event.reply("echo_reply", event.msg)))

# Reply with a set of random peers.
# The reply is used by the registering peer to select
# a partner (setup a WebRTC connection).

def handle_register(conn, event):
  logger.debug("Handle register: %s", event.to_json())
  peer = None
  guid = event.msg.guid

  # get a peer sample before we add ourselves
  peer_sample = random.sample(peers, min(5, len(peers)))

  # filter out the peer that registers
  try:
    peer_sample.remove(guid)
  except ValueError:
    # guid not in the sample
    pass

  # if the peer exist already we dont need to re-register
  # just return a random set of peers
  try:
    peer = peers[guid]
  except KeyError:
    peer = Peer(guid, conn)

    # register the peer and the connection
    peers[peer.guid] = peer
    conns[conn] = peer.guid

  peer.send(event.reply("register_reply", {"peers": peer_sample}))


# Handle an offer for a channel between two peers. The offer is from
# a local peer to a remote peer. The remote peer will respond with an
# answer.
def handle_offer(conn, event):
  logger.debug("Handle offer %s", event.to_json())

  guid_local = event.msg.guid
  guid_remote = event.msg.offer_to_guid
  chan_id = event.msg.channel

  peer_local = peers.get(guid_local)
  peer_remote = peers.get(guid_remote)

  # if none of the peers exist, an offer should not be sent, 
  # the local peer should timeout the offer and try with another
  # remote peer
  if peer_local is not None and peer_remote is not None:
    # both peers are registered and connected to the server
    ice_candidates = event.msg.candidates or []

    chan = Channel(chan_id, event.msg.offer, peer_local, candidates = ice_candidates)
    channels[chan_id] = chan
    chan.remote_peer = peer_remote

    # construct and send the offer to the remote peer
    ev = Event("offer", {
      "peer": peer_local.to_json(), 
      "channel": chan.to_local_json()
    })

    peer_remote.send(ev)


def handle_reject_offer(conn, event):
  logger.debug("Handle reject offer %s", event.to_json())
  offer_from = event.msg.offer_from_guid
  rejected_by = event.msg.guid
  channel = event.msg.channel

  # get the peer that should receive the reject
  peer = peers.get(offer_from)

  # try to send the event if the peer is still connected
  if peer is not None:
    ev = Event("offer_rejected", {
      "rejected_by": rejected_by,
      "channel": channel 
    })

    peer.send(ev)

# Pass back the answer to the remote peer
def handle_answer(conn, event):
  logger.debug("Handle answer: %s", event.to_json())
  # pass back the answer to the corresponding channel
  chan_id = event.msg.channel

  try:
    chan = channels[chan_id]

    chan.local_peer.send(Event("answer", {
      "answer": event.msg.answer, 
      "remote_peer": event.msg.guid, 
      "channel": chan.to_remote_json()
    }))

  except KeyError:
    logger.warning("Channel for answer not found %s", chan_id)

def handle_update_ice(conn, event):
  try:
    chan = channels[event.msg.channel]

    # figure out if this is the local/remote peer
    if chan.local_peer.guid == event.msg.guid:
      # the local peer (who sent the initial offer) updates the ice candidates
      # send the message to the remote peer
      if chan.remote_peer:
        chan.add_local_ice_candidates(event.msg.candidates)
        logger.debug("Updated local ice candidates for channel: %s, %s", chan.label, event.msg.candidates)

        chan.remote_peer.send(Event("update_ice_candidates", {"channel": chan.to_local_json()}))
    else:
      # new ice candidates from the remote peer (who received the offer)
      chan.add_remote_ice_candidates(event.msg.candidates)
      logger.debug("Updated remote ice candidates for channel: %s, %s", chan.label, event.msg.candidates)
      chan.local_peer.send(Event("update_ice_candidates", {"channel": chan.to_remote_json()}))

  except KeyError:
    logger.warning("No matching peer: %s", event)

# request all current connections
def handle_all_peers(conn, event):
  all_peers = map(lambda p: p.to_json(), peers.values())

  conn.send(json.dumps(event.reply("all_peers_reply", {"peers": all_peers}).to_json()))

def disconnect(conn):
  try:
    guid = conns[conn]
    peer = peers[guid]

    # clear the channels the peer is associated with
    for chan in peer.channels:
      try:
        del channels[chan]
      except KeyError:
        pass

    del peers[guid]
    del conns[conn]
    logger.debug("Disconnected peer %s", guid)
  except KeyError:
    logger.warning("Couldnt find a peer matching the connection %s", conn)

