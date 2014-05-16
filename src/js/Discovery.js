/*
 * The copyright in this software is being made available under the BSD License, included below. This software may be subject to other third party and contributor rights, including patent rights, and no such rights are granted under this license.
 * 
 * Copyright (c) 2014, Peerialism AB
 * All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * •  Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * •  Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * •  Neither the name of the Digital Primates nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

Discovery = (function() {
    // setup the socket to the discovery service
    var ws = {},
        self = {},
        pending = {},
        counter = new Counter()
        
    self.peers = {}

    self.init = function() {
        ws = new WebSocket(service)

        var p = new Promise(function(resolve, reject) {
            ws.onopen = function(ev) {
                console.log("Discovery service connection is ready.", ev)
                resolve(ev)
            }
        })

        ws.onclose = function(ev) {
            console.error("Discovery service connection closed.")
        }

        ws.onerror = function(error) {
            console.error("Discovery service connection error: ", error)
        }

        ws.onmessage = function(msg) {
            var ev = JSON.parse(msg.data)

            // if this is a response, the id is set, get the corresponding promise
            if (ev.id) {
                var p = pending[ev.id]
                if (p) {
                    delete pending[ev.id]
                    p(ev)
                }
            } else {
                // this is not a response, trigger a function on the peer
                Peer.trigger(ev)
            }
        }

        return p
    }

    self.event = function(name, msg) {
        return {
            id: counter.next(),
            name: name,
            msg: msg
        }
    }

    // Send an event to the service expecting a response
    var request = function(ev) {
        var p = new Promise(function(resolve, reject) {
            ws.send(JSON.stringify(ev))

            pending[ev.id] = resolve
        })

        return p
    }

    var trigger = function(ev) {
        ws.send(JSON.stringify(ev))
        return Promise.resolve()
    }

    self.echo = function() {
        var ev = self.event("echo", {hello: "world!"})
        console.log("Sending echo", ev)
        return request(ev)
    }

    self.all_peers = function() {
        var ev = self.event("all_peers", {})
        console.debug("Discovery service asks for all peers")
        return request(ev)
    }

    self.register = function(peer) {
        var ev = self.event("register", {
            guid: peer.guid,
        })

        console.log("Discovery service register peer", ev)
        return request(ev)
            .then(function(resp) {
                peers = resp.msg.peers
                for (var p in peers) {
                    // add the peers to the local list
                    self.peers[peers[p]] = true
                }

                return peers
            })
    }

    self.updateICE = function(localPeer, channel, candidates) {
        var ev = self.event("update_ice", {
            guid: localPeer,
            channel: channel.label,
            candidates: candidates
        })

        return trigger(ev)
    }

    self.offer = function(localPeer, remotePeer, channel, offer) {
        var ev = self.event("offer", {
            guid: localPeer,
            offer_to_guid: remotePeer,
            channel: channel.label,
            candidates: [], // channel.candidates,
            offer: offer
        })

        return trigger(ev)
    }

    self.rejectOffer = function(localPeer, remotePeer, channelLabel) {
      console.log("Discovery service rejects offer from peer", remotePeer)
      var ev = self.event("reject_offer", {
        guid: localPeer,
        offer_from_guid: remotePeer,
        channel: channelLabel
      })

      return trigger(ev)
    }

    self.answer = function(peer, channel, answerData) {
        console.log("Sending back an answer: ", peer, channel, answerData)
        var ev = self.event("answer", {
            guid: peer.guid,
            channel: channel.label,
            answer: answerData
        })

        return trigger(ev)
    }

    return self
})()
