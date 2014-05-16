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

Channel = function(label, channelOptions, ice) {
    var self = {}

    self.guid 
    self.channelOptions = channelOptions
    self.candidates = []
    self.label = label
    self.ice = ice

    self.pc = null
    self.channel = null
    self.remotePeer = null
    self.p2pTransport = new P2PTransport(self);

    self.connectTimer = null
    self.connectRetries = 15
    var timeout = 1000

    // initialize a peer connection and the channel
    var init = function() {
        self.pc = new RTCPeerConnection(self.ice, self.channelOptions)
        
        // setup callbacks for new ice candidates and changes
        self.pc.onicecandidate = function(evt) {
            if (evt.candidate) {
                self.candidates.push(evt.candidate)
            }

            if (evt.target.iceGatheringState == 'complete') {
                Discovery.updateICE(Peer.guid, self, self.candidates).then(function(resp) {
                    self.candidates = []
                }).catch(Log.error);
            }
        }
        
        self.pc.oniceconnectionstatechange = function(evt) {
            if(evt.target.iceConnectionState == 'disconnected') {
                self.close()
            }

        }

        self.pc.onsignalingstatechange = function(ev) {
            if(ev.signalingState == 'closed')
                self.close()
        }
    }

    self.checkConnection = function() {
        console.debug("Check connection", self)

        if(self.connectRetries <= 0) {
            console.warn("Closing channel since it couldnt be established: " + self.label)
            self.close()
            return
        }

        // if we are still connecting, wait for a bit longer
        if(self.channel && self.channel.readyState != 'open') {
            self.connectRetries -= 1
            self.connectTimer = setTimeout(self.checkConnection, timeout)
        }
    }

    self.close = function() {
        
        Peer.closeConnection(self)
        
        // shutdown this channel

        if(self.pc && self.pc.signalingState != 'closed') {
            self.pc.close()
        }

        if(self.channel)
            self.channel.close()
    }

    self.isConnecting = function() {
        if(self.channel) {
            return self.channel.readyState === "connecting"
        } else {
            return false
        }
    }

    // Returns a promise that resolves when the data channel is ready/open
    self.connect = function(remotePeer) {
        console.log(self.label, " connecting to ", remotePeer)

        self.remotePeer = remotePeer

        // init the rtc peer conn and data channel
        init()

        // channel is set by the initiator
        self.channel = self.pc.createDataChannel(self.label)
        var openPromise = setupChannel()

        // timer that closes the connection if it is not possible to setup
        self.connectTimer = setTimeout(self.checkConnection, timeout)

        // initiate the offer and return to the caller
        createOffer()
        .then(setLocal)
        .then(function(offer) {
            return Peer.initOffer(remotePeer, self, offer)
        })
        .catch(console.error)

        return openPromise
    }

    setRemote = function(sdp) {
        return new Promise(function(resolve, reject) {
            self.pc.setRemoteDescription(
                sdp,
                function() {
                    resolve()
                },
                reject
            )
        })
    }

    setLocal = function(sdp) {
        return new Promise(function(resolve, reject) {
            self.pc.setLocalDescription(
                sdp,
                function() {
                    resolve(self.pc.localDescription)
                },
                reject
            )
        })
    }

    createOffer = function() {
        return new Promise(function(resolve, reject) {
            self.pc.createOffer(resolve, Log.error)
        })
    }

    createAnswer = function() {
        return new Promise(function(resolve, reject) {
            self.pc.createAnswer(resolve, reject)
        })
    }

    self.offer = function(ev) {
        // receives an offer (via Peer/Discovery service)

        // create the new RTCPeerConnection
        init()

        self.pc.ondatachannel = function(ev) {
            self.channel = ev.channel
            setupChannel()
        }

        var session = new RTCSessionDescription(ev.channel.offer)
        console.log("Channel ", self.label, " received an offer", ev, "created sdp", session)

        self.remotePeer = ev.peer.guid

        setRemote(session)
            .then(createAnswer)
            .then(setLocal)
            .then(function(localSdp) {
                Discovery.answer(Peer, self, localSdp)
            })
            .then(function() {
                // set any ice candidates part of the offer channel
                var candidates = ev.channel.ice_candidates
                for (var c in candidates) {
                    var iceCandidate = new RTCIceCandidate(candidates[c])
                    self.pc.addIceCandidate(iceCandidate)
                }
            })
            .catch(console.error)
    }

    self.answer = function(ev) {
        // receives an answer from the discovery service
        // the remote peer sends back an answer,
        // we can still get more ice candidates after this
        var sdp = new RTCSessionDescription(ev.answer)

        setRemote(sdp)
            .catch(console.error)
    }

    self.update_ice_candidates = function(ev) {
        var candidates = ev.channel.ice_candidates

        for (var c in candidates) {
            var iceCandidate = new RTCIceCandidate(candidates[c])
            self.pc.addIceCandidate(iceCandidate)
        }
    }

    var setupChannel = function() {
        // promise is triggered when the channel
        var p = new Promise(function(resolve, reject) {
            self.channel.onopen = function(ev) {
                resolve(self)
                Peer.sendAllHaves(self.remotePeer);
            }
 
            self.channel.onclose = function(ev) {
                self.close()
                reject(self)
            }
       })

        self.channel.onmessage = function(ev) {
            self.p2pTransport.receiveMessage(ev);
        }

        self.channel.onerror = function(err) {
            console.error("-- WebRTC channel error", err)
        }

        return p
    }

    return self
}
