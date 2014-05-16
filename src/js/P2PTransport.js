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

P2PTransport = function(channel) {

    var self = {}
    self.channel = channel;

    self.pendingRequests = {};
    self.inMsg = null;
    //self.requestOrder = [];

    self.outMsg = null;
    self.pendingOutRequests = [];

    self.sendHave = function(fragmentId) {

        console.debug("SEND HAVE TO " + self.channel.remotePeer + " FOR " + fragmentId);

        var have = new Have(fragmentId);

        self.sendMessage(Transport.MsgTypes.Have, have);

    };
    
    self.sendClose = function() {

        console.debug("SEND CLOSE TO " + self.channel.remotePeer);

        var close = new Close();

        self.sendMessage(Transport.MsgTypes.Close, close);

    };

    self.sendRequest = function(p2pRequest) {

        var fragmentId = p2pRequest.fragmentId;
        var transferId = p2pRequest.transferId;

        var request = new Request(fragmentId, transferId);

        p2pRequest.timerId = setTimeout(function() {
            self.requestTimedout(transferId)
        }, Transport.TimeOut);

        console.info("INITIATING TR-" + transferId + " WITH TO " + Transport.TimeOut + " FOR FRAGMENT " + fragmentId);

        self.pendingRequests[transferId] = p2pRequest;

        self.sendMessage(Transport.MsgTypes.Request, request);

    };

    self.inUse = function() {
        if (self.pendingOutRequests.length === 0 && self.outMsg === null && Object.keys(self.pendingRequests).length === 0 && self.inMsg === null)
            return false;
        return true;
    };

    self.stopTransfer = function(transferId, reason) {

        if (transferId in self.pendingRequests) {

            var cancel = new Cancel(transferId);

            self.sendMessage(Transport.MsgTypes.Cancel, cancel);

            var p2pRequest = self.pendingRequests[transferId];

            p2pRequest.onError(reason);

            if (self.inMsg !== null && self.inMsg.transferId === transferId)
                self.inMsg = null;

            delete self.pendingRequests[transferId];


        } else
            console.warn("CLEAN UP NOT PENDING " + transferId);

    }

    self.requestTimedout = function(transferId) {

        console.info("TIMED OUT " + transferId);

        self.stopTransfer(transferId, "TIMED OUT");

    }

    self.sendFragment = function(fragmentId, transferId, data) {


        console.info("SEND FRAGMENT " + fragmentId + " TO " + self.channel.label);

        var response = new Response(fragmentId, transferId, data);

        //console.info("FR " + response.fragmentId);

        self.pendingOutRequests.push(response);

        if (self.outMsg === null)
            self.sendFragmentChunks();

    };


    self.sendAck = function(transferId) {

        //console.info("SEND ACK " + transferId + " TO " + self.channel.label);

        var response = new Ack(transferId);

        self.sendMessage(Transport.MsgTypes.Ack, response);

    };


    self.sendFragmentChunks = function() {

        try
        {
            if (self.outMsg === null) {

                if (self.pendingOutRequests.length !== 0) {

                    var msg = self.pendingOutRequests.shift();

                    console.debug("START SENDING " + msg.fragmentId);

                    var encodedMessage = msg.encode();
                    var encodedFragmentArray = encodedMessage.toArrayBuffer();
                    var encodedFragmentArrayLength = encodedFragmentArray.byteLength;

                    var wordArray = CryptoJS.lib.WordArray.create(encodedFragmentArray);
                    var hashedKey = CryptoJS.MD5(wordArray);

                    //console.debug("HASH " + hashedKey.toString());

                    var transferId = msg.transferId;

                    var bytebuffer = new ByteBuffer();
                    bytebuffer.writeByte(Transport.MsgTypes.Fragment);
                    bytebuffer.writeInt(transferId);
                    bytebuffer.writeInt(encodedFragmentArrayLength);
                    bytebuffer.writeLString(hashedKey.toString());
                    bytebuffer.append(encodedMessage);

                    //console.debug("ENCODED PAYLOAD LENGTH ", encodedFragmentArrayLength, " HASH ", hashedKey.toString());

                    self.outMsg = new P2PResponse();
                    self.outMsg.transferId = transferId;
                    self.outMsg.msgId = msg.fragmentId;
                    self.outMsg.dataToSend = bytebuffer.toArrayBuffer();
                    self.outMsg.dataToSendLength = self.outMsg.dataToSend.byteLength;
                    self.outMsg.chunkNums = Math.ceil(self.outMsg.dataToSendLength / Transport.ChunkSize);
                    self.outMsg.sentAlready = 0;

                    console.debug("DATA TO SEND LENGTH " + self.outMsg.dataToSendLength + " IN " + self.outMsg.chunkNums + " CHUNKS WITH TR-" + self.outMsg.transferId);

                    self.sendChunks(true);

                } else {
                    console.info("NO MORE FRAGMENTS TO SEND");
                }

            }

        } catch (err) {
            console.error(err);
            self.resetSendState();
        }

    }

    self.resetSendState = function() {
        self.outMsg = null;
    }

    self.sendChunks = function(first) {

        try
        {
            if (self.outMsg !== null) {

                if (self.outMsg.chunkNums === 0) {

                    console.debug("FINISHED SENDING " + self.outMsg.msgId);

                    self.outMsg = null;

                    self.sendFragmentChunks();

                } else {

                    var till = Math.min(self.outMsg.sentAlready + Transport.ChunkSize, self.outMsg.dataToSendLength);

                    var bytebuffer = new ByteBuffer();

                    if (!first)
                        bytebuffer.writeInt(self.outMsg.transferId);

                    var sl = self.outMsg.dataToSend.slice(self.outMsg.sentAlready, till);

                    bytebuffer.append(sl);

                    self.outMsg.sentAlready = self.outMsg.sentAlready + (till - self.outMsg.sentAlready);

                    //console.debug("SND " + self.outMsg.sentAlready + "/" + self.outMsg.dataToSendLength + " TO " + self.channel.remotePeer + " OF TR-" + self.outMsg.transferId);

                    self.channel.channel.send(bytebuffer.toArrayBuffer());

                    self.outMsg.chunkNums--;

                }

            } else {
                console.debug("NO MESSAGE TO SEND");
            }
        } catch (err) {
            self.resetSendState();
        }



    }

    self.sendMessage = function(msgId, msg) {

        try
        {
            var actualChannel = self.channel.channel;
            var encodedMessage = msg.encode();
            var encodedFragmentArray = encodedMessage.toArrayBuffer();
            var encodedFragmentArrayLength = encodedFragmentArray.byteLength;

            var wordArray = CryptoJS.lib.WordArray.create(encodedFragmentArray);
            var hashedKey = CryptoJS.MD5(wordArray);

            var bytebuffer = new ByteBuffer();
            bytebuffer.writeByte(msgId);
            bytebuffer.writeInt(encodedFragmentArrayLength);
            bytebuffer.writeLString(hashedKey.toString());
            bytebuffer.append(encodedMessage);

            var dataToSend = bytebuffer.toArrayBuffer();
            //var dataToSendLength = dataToSend.byteLength;

            //console.debug("SEND " + dataToSendLength + " HASH " + hashedKey.toString() + " TO " + self.channel.remotePeer);

            actualChannel.send(dataToSend);

        } catch (err) {
            console.error(err);
        }



    }

    self.receiveMessage = function(event) {

        var payload = event.data;
        var p2pMsg = self.inMsg;

        try {
            if (p2pMsg === null) {

                var bb = ByteBuffer.wrap(payload);

                var msgId = bb.readByte();

                //console.debug("NEW MESSAGE WITH ID " + msgId);

                // FRAGMENT 
                if (msgId === Transport.MsgTypes.Fragment) {

                    // Read transfer ID
                    var transferId = bb.readInt();

                    if (transferId in self.pendingRequests) {

                        console.debug("INITIATED TR-" + transferId);

                        p2pMsg = self.inMsg = self.pendingRequests[transferId];
                        p2pMsg.transferId = transferId;

                    } else {
                        console.debug("Received chunk of not existing transfer id " + transferId);
                        return;
                    }

                } else {

                    if (msgId <= Transport.MsgTypes.Ack)
                        // NORMAL MESSAGE
                        p2pMsg = self.inMsg = new Message();

                    else {
                        console.debug("MSG OF WRONG ID RECEIVED ");

                        self.inMsg = null;
                        return;
                    }

                }

                p2pMsg.msgId = msgId;
                p2pMsg.length = bb.readInt();
                p2pMsg.hash = bb.readLString();
                p2pMsg.rcvMesgData = bb.toArrayBuffer();

                //console.debug("MSG ID " + p2pMsg.msgId + " L " + p2pMsg.length + " H " + p2pMsg.hash);

                p2pMsg.onLoad(p2pMsg.rcvMesgData);

            } else {


                if (p2pMsg.msgId === Transport.MsgTypes.Fragment) {

                    var bb = new ByteBuffer.wrap(payload);

                    var transferId = bb.readInt();

                    if (transferId !== p2pMsg.transferId) {
                        console.debug("RCV CHUNK OF WRONG TR-" + transferId);
                        return;
                    }

                    payload = bb.toArrayBuffer();

                }

                p2pMsg.rcvMesgData = Utils.appendBuffer(p2pMsg.rcvMesgData, payload);

                //console.debug("REC " + p2pMsg.rcvMesgData.byteLength + "/" + p2pMsg.length + " OF TR-" + p2pMsg.transferId);

            }

            if (p2pMsg.msgId === Transport.MsgTypes.Fragment)
                self.sendAck(p2pMsg.transferId);

            if (p2pMsg.rcvMesgData.byteLength === p2pMsg.length) {

                clearTimeout(p2pMsg.timerId);

                var wordArrayRec = CryptoJS.lib.WordArray.create(p2pMsg.rcvMesgData);
                var hashKey = CryptoJS.MD5(wordArrayRec);
                if (hashKey.toString() !== p2pMsg.hash) {

                    var err = " INTEGRITY FAILED ";

                    console.warn(err);

                    self.fragmentDownloadError(err);

                } else {

                    if (p2pMsg.msgId === Transport.MsgTypes.Fragment)
                        console.debug("RCV ALL DATA " + p2pMsg.rcvMesgData.byteLength + " TR-" + p2pMsg.transferId);

                    self.deliverMessage(p2pMsg);

                    self.inMsg = null;
                }

            }


        } catch (err) {
            console.error("ERROR RECEIVING MESSAGE ", err);
            self.inMsg = null;
        }

    }

    self.deliverMessage = function(p2pMsg) {

        switch (p2pMsg.msgId)
        {
            case Transport.MsgTypes.Fragment:

                var fragment = Response.decode(p2pMsg.rcvMesgData);

                p2pMsg.fragmentData = fragment.data;

                delete self.pendingRequests[p2pMsg.transferId];

                Peer.deliverFragment(p2pMsg);

                break;

            case Transport.MsgTypes.Ack:

                var ack = Ack.decode(p2pMsg.rcvMesgData);

                //console.debug("ONGOING ",self.outMsg.transferId);

                if (self.outMsg !== null && self.outMsg.transferId.toString() === ack.transferId.toString())
                    self.sendChunks();
                else
                    console.warn("RECEIVED ACK FOR UNKNOWN TR-" + ack.transferId);

                break;

            case Transport.MsgTypes.Cancel:
                var cancel = Cancel.decode(p2pMsg.rcvMesgData);

                if (self.outMsg != null && self.outMsg.transferId === cancel.transferId) {
                    console.debug("GOT CANCEL FOR ONGOING TR-" + cancel.transferId);
                    console.debug("TRANSPORT CANCEL STATS " + Peer.guid + "," + channel.remotePeer + "," + cancel.transferId)
                    self.outMsg = null;
                    self.sendFragmentChunks();
                } else {
                    self.pendingOutRequests = _.filter(self.pendingOutRequests, function(req) { 
                        req.transferId !== cancel.transferId
                    })
                }

                break;

            case Transport.MsgTypes.Have:

                var have = Have.decode(p2pMsg.rcvMesgData);

                console.debug("RECEIVED HAVE FOR " + have.fragmentId + " FROM " + channel.remotePeer);

                ObjectIndex.put(have.fragmentId, channel.remotePeer);

                break;
                
            case Transport.MsgTypes.Close:
                
                var close = Close.decode(p2pMsg.rcvMesgData);
                
                console.debug("RECEIVED CLOSE FROM " + channel.remotePeer);
                
                Peer.closeConnection(channel);
            
                break;
            case Transport.MsgTypes.Request:

                var request = Request.decode(p2pMsg.rcvMesgData);

                console.debug("RECEIVED REQUEST FOR " + request.fragmentId + " FROM " + channel.remotePeer);

                if (FragmentCache.contains(request.fragmentId)) {

                    var fragment = FragmentCache.getFragment(request.fragmentId);

                    self.sendFragment(request.fragmentId, request.transferId, fragment.data);

                    console.debug("TRANSPORT REQUEST STATS " + Peer.guid + "," + channel.remotePeer + "," + request.fragmentId + "," + request.transferId + "," + fragment.data.byteLength)
                }

                break;
            default:
                console.warn("UNKNOWN MESSAGE TYPE " + p2pMsg.msgId);

        }

        p2pMsg.rcvMesgData = null;
    }

    self.fragmentDownloadError = function(err) {

        if (self.inMsg !== null) {

            if (self.inMsg.transferId in self.pendingOutRequests) {

                var p2pReq = self.pendingOutRequests[self.inMsg.transferId];

                p2pReq.onError(err);

                delete self.pendingOutRequests[self.inMsg.transferId];

            }
        }
    }


    return self
}


