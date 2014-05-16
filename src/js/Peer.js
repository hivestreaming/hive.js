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

var Peer = (function() {
    var self = {}
    var channelOptions = null;

    self.targetPeerCount = Overlay.MaxPartners;

    self.counter = new Counter()
    self.networkChanges = new Counter()

    self.guid = UUID()

    // channels created by the peer, that we offer connections to
    self.channels = {}

    // peers that the peer has connected with
    self.connections = {}

    self.isSendHaves = true;

    self.ice = {"iceServers": [
            {"url": "stun:stun.l.google.com:19302"},
            {"url": "turn:psm-hive-sig.cloudapp.net:3478", "username": "hive", "credential": "hiveturnSecret"}
        ]}


    var makeChannel = function(label, remoteGuid) {
        var c = new Channel(label, channelOptions, self.ice)
        self.channels[label] = c
        self.connections[remoteGuid] = c
        return c
    }

    self.renderPeers = function() {
        var table = $("#peers")
        var changeId = self.networkChanges.next()
        console.debug("[NetworkUpdate-" + changeId + "] for " + Peer.guid)

        console.debug("NETWORK STATS " + Peer.guid + "," + self.targetPeerCount + "," + _.size(self.connections))

        table.empty()
        for (var g in self.connections) {
            var conn = self.connections[g],
                chanState;

            if (conn.channel == null)
                chanState = 'unknown'
            else
                chanState = conn.channel.readyState

            console.debug("[NetworkUpdate-" + changeId + "] " + g + ", " + conn.pc.signalingState + ", " + chanState + ", " + conn.pc.iceConnectionState + ", " + conn.pc.iceGatheringState)
            table.append(
                "<tr> \
          <td>" + g + "</td> \
          <td>" + conn.pc.signalingState + "</td> \
          <td>" + chanState + "</td> \
          <td>" + conn.pc.iceConnectionState + "</td> \
          <td>" + conn.pc.iceGatheringState + "</td> \
          </tr>"
                )
        }
    }

    // called periodically to update the connections + reactively when
    // a peer (channel/connection) change state
    self.update = function() {
        console.log("Update called with ", _.size(self.connections), " existing peers, target: ", self.targetPeerCount, self.connections)
        self.renderPeers()
        if (_.size(self.connections) < self.targetPeerCount) {
            return Discovery.register(self)
                .then(function(peers) {

                    // 1. filter out peers we already have a connection to
                    var newPeers = _.filter(peers, function(p) {
                        return _.has(self.connections, p) == false
                    })

                    // 2. take enough peers to fill up the target count
                    var fillCount = self.targetPeerCount - _.size(self.connections)
                    newPeers = newPeers.slice(0, fillCount)

                    // READ THIS (TODO)
                    // Peer connections being setup concurrently doesnt seem to work
                    // thus, we only connect to the next peer when the previous is done

                    console.log("Connect to peers returned by Discovery service: ", newPeers)
                    var p = newPeers.reduce(function(seqPromise, nextPeer) {
                        return seqPromise
                            .then(function() { 
                                return self.connect(nextPeer)
                            })
                            .catch(function() {
                                // previous connection was rejected, try next
                                return self.connect(nextPeer)
                            })
                    }, Promise.resolve())

                    return p
                })
        }

    }

    // Initializes the peer by updating the Discovery service.
    // Retrieves a random set of peers and set up connections
    self.init = function() {

        // make sure that the update function to get new peers from the Discovery
        // service is called periodically

        setInterval(self.update, 15000)
        setTimeout(function() {
            self.periodicChoking()
        }, Overlay.Choking);
        return self.update()
    }

    self.trigger = function(ev) {
        var chan = ev.msg.channel

        console.log(self.guid, "dispatches message: ", ev, chan, self.channels)

        if (chan && chan.label && self.channels[chan.label]) {
            // get or create a new channel
            var c = self.channels[chan.label]

            // dispatch the message
            var func = c[ev.name]
            func(ev.msg)
        } else {
            // this is not a channel signaling message, dispatch to peer
            var func = self["handle_" + ev.name]
            if (func)
                func(ev.msg)
        }
    }

    // recieve an offer from another peer
    self.handle_offer = function(ev) {
        console.log(self.guid, "received an offer", ev)

        var conn = self.connections[ev.peer]

        // existing open connection
        var rejectOpen = conn && !conn.isConnecting()

        // connecting (but our offer should be used)
        var rejectConnecting =
            conn &&
            conn.isConnecting() &&
            ev.peer < self.guid

        // reject if
        // 1) no free slots
        // 2) an open connection to the peer exists
        // 3) an ongoing offer from us exist and we have precedence
        var reject =
            _.size(self.connections) >= self.targetPeerCount ||
            rejectOpen ||
            rejectConnecting

        // no free connections or ongoing conn => reject
        if (reject) {
            // let the peer know that we cannot accept the offer
            Discovery.rejectOffer(self.guid, ev.peer.guid, ev.channel.label)
        } else {
            // setup a new connection
            var c = makeChannel(ev.channel.label, ev.peer.guid)
            c.offer(ev)
        }
    }


    // remote peer rejected our offer
    self.handle_offer_rejected = function(ev) {
        console.log(self.guid, "remote peer rejected", ev)

        var chan = self.connections[ev.rejected_by]

        if (chan) {
            chan.close()
        }

        delete self.connections[ev.rejected_by]
        delete self.channels[ev.channel]
    }

    self.register = function(offer) {
        return Discovery.register(self)
    }

    self.initOffer = function(remotePeer, channel, offer) {
        return Discovery.offer(self.guid, remotePeer, channel, offer)
    }

    self.connect = function(remotePeer) {
        // create a connection with the given peer
        console.log(self.guid, "initating connection with ", remotePeer)

        // create a label, local peer + channel id
        var label = self.guid + ":" + self.counter.next()
        var channel = makeChannel(label, remotePeer)

        // connect the channel to the remote peer
        return channel.connect(remotePeer).then(function(ev) {
            self.renderPeers();
            return ev
        })
    }

    self.closeConnection = function(channel) {
        // clear out the connection data
        console.log(self.guid, "closing connection to ", channel.remotePeer, channel.label, self.channels, self.connections)

        if (channel.remotePeer in self.connections) {

            console.debug("CLOSING PEER IN CONNECTIONS" + channel.remotePeer);

//            if (!typeof ObjectIndex === 'undefined') {
            console.debug("OBJ IDX, REMOVING PEER " + channel.remotePeer);
            ObjectIndex.removePeer(channel.remotePeer);
//            }else
//                console.debug("OBJ IDX UNDEFINED ",ObjectIndex);

            delete self.channels[channel.label]
            delete self.connections[channel.remotePeer]
            self.renderPeers()
        }
    }

    self.sendHaves = function(fragmentId) {

        if (self.isSendHaves) {
            for (var guid in self.connections)
                self.sendHave(guid, fragmentId);
        }

    }

    self.sendHave = function(guid, fragmentId) {

        var conn = self.connections[guid];

        if (self.isChannelOpen(conn.channel)) {

            console.debug("SEND HAVE FOR " + fragmentId + " TO " + guid);

            var channel = self.connections[guid];

            channel.p2pTransport.sendHave(fragmentId);

        } else {
            console.debug("CHANNEL TO  " + guid + " NOT OPEN ");
        }

    }

    self.sendAllHaves = function(remotePeer) {

        if (self.isSendHaves) {
            if (remotePeer in self.connections) {

                console.debug("SEND ALL HAVES TO " + remotePeer);

                var ids = FragmentCache.getKeys();

                for (var i = 0; i < ids.length; i++)
                    self.sendHave(remotePeer, ids[i]);


            } else {
                console.debug("NO PEER TO SEND TO " + remotePeer);
            }
        }
    }

    self.sendRequest = function(p2pRequest) {

        var fragmentId = p2pRequest.fragmentId;

        var partners = ObjectIndex.getPartners(fragmentId);

        try {

            if (typeof partners !== 'undefined') {

                var choice = _.filter(partners, function(p) {
                    if (p in self.connections) {
                        var channel = self.connections[p];
                        return channel.channel.readyState === 'open';
                    } else
                        return false;
                });
                
                console.debug("CHOICE ",choice);

                if (choice.length > 0) {
                    var rnd = Math.round(Math.random() * (choice.length - 1));

                    var chosen = choice[rnd];
                    
                    if (chosen in self.connections) {

                        var channel = self.connections[chosen];

                        console.debug("SEND REQUEST FOR " + fragmentId + " TO " + chosen + " CHANNEL " + channel + " " + channel.p2pTransport);

                        p2pRequest.channel = channel;

                        channel.p2pTransport.sendRequest(p2pRequest);

                    } else
                        p2pRequest.onError("CHANNEL TO " + chosen + " DOES NOT EXIST ");
                }
            } else
                p2pRequest.onError("NO PARTNERS");

        } catch (err) {
            console.error("ERROR ", err);
            p2pRequest.onError(err);
        }
    }

    self.cancelRequest = function(p2pRequest) {

        if (p2pRequest.channel in self.connections) {

            p2pRequest.channel.p2pTransport.stopTransfer(p2pRequest.transferId, "ABORT");

        } else {
            console.warn("CALLED CANCEL REQUEST ON NON EXISTING SESSION");
        }

    }

    self.isChannelOpen = function(channel) {
        if (channel && channel.readyState === "open")
            return true;
        return false;
    }

    self.periodicChoking = function() {

        console.info("CHOKING", self.connections);

        var pLength = _.size(self.connections)
        var keys = [];
        for (var conn in self.connections) {
            var open = self.isChannelOpen(self.connections[conn].channel)
            var inUse = self.connections[conn].p2pTransport.inUse()
            console.debug("CHOKING CHECKING PEER " + conn + " STATE " + open + " IS USED " + inUse)
            if (open && !inUse)
                keys.push(conn)
        }

        console.debug("CHOKING FOUND " + keys.length + " POTENTIAL PEERS, MAX PARTNERS " + Overlay.MaxPartners)

        if (keys.length >= Overlay.MaxPartners) {
            var rnd = Math.round(Math.random() * (keys.length - 1))
            var chokePeer = keys[rnd]
            var conn = self.connections[chokePeer]
            console.debug("CHOKING PEER " + chokePeer, conn);

            conn.p2pTransport.sendClose();

            conn.close()
        }

        setTimeout(function() {
            self.periodicChoking()
        }, Overlay.Choking)
    }


    self.deliverFragment = function(p2pRequest) {

        p2pRequest.onComplete(p2pRequest.fragmentId, p2pRequest.fragmentData);

    }

    return self
})()
