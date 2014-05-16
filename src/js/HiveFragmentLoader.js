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

Hive.p2p.HiveFragmentLoader = function() {
    "use strict";

    var RETRY_ATTEMPTS = 3,
        RETRY_INTERVAL = 500,
        hiveRequests = [],
        pendingP2PRequests = {},
        hiveLoadNext = function() {

            var self = this;

            if (hiveRequests.length > 0) {

                var lastHiveRequest = hiveRequests.shift();
                lastHiveRequest.requestStartDate = new Date();
                lastHiveRequest.firstByteDate = lastHiveRequest.requestStartDate;

                var fragmentId = Utils.genFragmentId(lastHiveRequest.url, lastHiveRequest.range);

                if (ObjectIndex.contains(fragmentId)) {

                    //console.debug("OBJ IDX CONTAINS " + lastHiveRequest.url);

                    p2pRequest(self, lastHiveRequest, fragmentId);

                } else
                    fallbackRequest(self, lastHiveRequest);

                hiveLoadNext.call(self);

            } else {
                //console.debug("LOADING FALSE");
                //hiveLoading = false;
            }
        },
        p2pRequest = function(self, lastHiveRequest, fragmentId) {

            console.debug("FRL ISSUE REQ FOR FRAGMENT " + fragmentId + " TO P2P ");

            var p2pRequest = new P2PRequest();

            p2pRequest.transferId = FragmentCounter.next();
            p2pRequest.fragmentId = fragmentId;
            p2pRequest.requestedTs = new Date();

            pendingP2PRequests[p2pRequest.transferId] = p2pRequest;

            p2pRequest.onLoad = function(result) {

                // register metrics
                Metrics.increase("traffic", "reqN", 1)

                lastHiveRequest.firstByteDate = new Date();

            };

            p2pRequest.onComplete = function(fragmentId, data) {

                console.debug("FRL PROMISED FRAGMENT " + fragmentId + " RETURNED");

                var bytes = data.toArrayBuffer();

                Metrics.increase("traffic", "p2pSubReqN", 1)
                Metrics.increase("traffic", "p2pSubRespN", 1)
                Metrics.increase("traffic", "p2pSubRespQt", bytes.byteLength)

                handleSuccessfulPerfMetrics(self, lastHiveRequest, bytes, 200, "p2p");

                deliverAndReset(lastHiveRequest, bytes);

                console.debug("FRL GOT " + fragmentId + " " + bytes.byteLength);

                delete pendingP2PRequests[lastHiveRequest];

                lastHiveRequest = null;

            };

            p2pRequest.onError = function(err) {

                console.error("FRL FAILED TO DOWN FROM P2P " + err + " FOR " + lastHiveRequest);

                Metrics.increase("traffic", "p2pSubReqN", 1)
                Metrics.increase("traffic", "p2pSubRespErrN", 1)

                console.warn("FRL P2P FAILED FOR " + lastHiveRequest.url + " SEND TO FALLBACK");

                delete pendingP2PRequests[lastHiveRequest];

                fallbackRequest(self, lastHiveRequest);

                //onError(self, lastHiveRequest, 412, "P2P failed to download fragment");

            };

            Peer.sendRequest(p2pRequest);

        },
        deliverAndReset = function(lastHiveRequest, bytes, self) {

            lastHiveRequest.deferred.resolve({
                data: bytes,
                request: lastHiveRequest
            });


            if (lastHiveRequest.type !== "Initialization Segment") {
                // STORE FRAGMENT
                var fragmentId = FragmentCache.putFragment(lastHiveRequest, bytes);

                // SEND HAVES
                Peer.sendHaves(fragmentId);

            }

            hiveLoadNext.call(self);

            lastHiveRequest.deferred = null;
            lastHiveRequest = null;
        },
        handlePerformanceMetrics = function(self, lastHiveRequest, bytes, status, transferType) {

            var httpRequestMetrics = null;

            lastHiveRequest.requestEndDate = new Date();

            var latency = (lastHiveRequest.firstByteDate.getTime() - lastHiveRequest.requestStartDate.getTime()),
                download = (lastHiveRequest.requestEndDate.getTime() - lastHiveRequest.firstByteDate.getTime()),
                total = (lastHiveRequest.requestEndDate.getTime() - lastHiveRequest.requestStartDate.getTime());

            var fragmentId = Utils.genFragmentId(lastHiveRequest.url, lastHiveRequest.range);

            var segmentSize = 0

            if(bytes != null) {
                segmentSize = bytes.byteLength
            }

            console.debug("FRL SEGMENT LOADED: ( " + latency + " ms, " + download + " ms, " + total + " ms, " + segmentSize +
                " bytes, " + lastHiveRequest.type + " " + transferType + " ) " + fragmentId + " BY " + Peer.guid);

            var stats = [
              latency,
              download,
              total,
              segmentSize,
              transferType,
              lastHiveRequest.type,
              lastHiveRequest.streamType,
              lastHiveRequest.quality,
              lastHiveRequest.index,
              fragmentId,
              Peer.guid,
              _.size(Peer.connections),
              Peer.targetPeerCount
            ]

            console.debug("SEGMENT STATS " + stats.join(","))

            var retStatus = status;
            if (retStatus === null)
                retStatus = 200;


            httpRequestMetrics = self.metricsModel.addHttpRequest(lastHiveRequest.streamType,
                null,
                lastHiveRequest.type,
                lastHiveRequest.url,
                null,
                lastHiveRequest.range,
                lastHiveRequest.requestStartDate,
                lastHiveRequest.firstByteDate,
                lastHiveRequest.requestEndDate,
                retStatus,
                null,
                lastHiveRequest.duration);


            return httpRequestMetrics;

        },
        handleSuccessfulPerfMetrics = function(self, lastHiveRequest, bytes, status, transferType) {

            var httpRequestMetrics = handlePerformanceMetrics(self, lastHiveRequest, bytes, status, transferType);

            self.metricsModel.appendHttpTrace(httpRequestMetrics,
                lastHiveRequest.requestEndDate.getTime(),
                new Date().getTime() - lastHiveRequest.requestEndDate.getTime(),
                [bytes.byteLength]);

        },
        fallbackRequest = function(self, lastHiveRequest, remainingAttempts) {

            var req = new XMLHttpRequest(),
                firstProgress = true,
                loaded = false;


            if (lastHiveRequest.type !== "Initialization Segment") {
                Metrics.increase("traffic", "reqN", 1)
            }

            req.open("GET", lastHiveRequest.url, true);

            var fragmentId = Utils.genFragmentId(lastHiveRequest.url, lastHiveRequest.range);

            console.debug("FRL ISSUE REQ FOR FRAGMENT " + fragmentId + " TO FALLBACK ");

            req.responseType = "arraybuffer";

            /*
             req.setRequestHeader("Cache-Control", "no-cache");
             req.setRequestHeader("Pragma", "no-cache");
             req.setRequestHeader("If-Modified-Since", "Sat, 1 Jan 2000 00:00:00 GMT");
             */
            if (lastHiveRequest.range) {
                req.setRequestHeader("Range", "bytes=" + lastHiveRequest.range);
            }

            req.onprogress = function(event) {
                if (firstProgress) {
                    firstProgress = false;
                    if (!event.lengthComputable || (event.lengthComputable && event.total != event.loaded)) {
                        lastHiveRequest.firstByteDate = new Date();
                    }
                }
            };

            req.onload = function() {
                if (req.status < 200 || req.status > 299) {
                    console.debug("FRL SERVER RETURNED ERROR CODE " + req.status)
                    return;
                }
                loaded = true;
                lastHiveRequest.requestEndDate = new Date();

                var bytes = req.response;

                if (lastHiveRequest.type !== "Initialization Segment") {
                    Metrics.increase("traffic", "srcRespN", 1)
                    Metrics.increase("traffic", "srcRespQt", bytes.byteLength)
                    Metrics.increase("traffic", "srcReqN", 1)
                }

                handleSuccessfulPerfMetrics(self, lastHiveRequest, bytes, req.status, "src");

                deliverAndReset(lastHiveRequest, bytes, self);

                req = null;


            };

            req.onloadend = req.onerror = function() {
                if (loaded) {
                    return;
                }

                if (lastHiveRequest.type !== "Initialization Segment") {
                    Metrics.increase("traffic", "srcReqN", 1)
                    Metrics.increase("traffic", "srcRespErrN", 1)
                }
                console.debug("FRL CANNOT RETRIEVE " + lastHiveRequest.url);

                if (remainingAttempts > 0) {
                    self.debug.log("FRL Failed loading segment: " + lastHiveRequest.streamType + ":" + lastHiveRequest.type + ":" + lastHiveRequest.startTime + ", retry in " + RETRY_INTERVAL + "ms" + " attempts: " + remainingAttempts);
                    remainingAttempts--;
                    setTimeout(function() {
                        fallbackRequest(self, lastHiveRequest, remainingAttempts);
                    }, RETRY_INTERVAL);
                } else {
                    self.debug.log("FRL Failed loading segment: " + lastHiveRequest.streamType + ":" + lastHiveRequest.type + ":" + lastHiveRequest.startTime + " no retry attempts left");
                    self.errHandler.downloadError("content", lastHiveRequest.url, req);
                    onError(self, lastHiveRequest, req.status, "Error loading fragment.", "src");
                }
            };
            req.send();
        },
        onError = function(self, lastHiveRequest, status, reason, transferType) {
            handlePerformanceMetrics(self, lastHiveRequest, null, status, transferType + "_error");

            lastHiveRequest.deferred.reject(reason);

            hiveLoadNext.call(self);
        },
        checkForExistence = function(request, remainingAttempts) {
            var req = new XMLHttpRequest(),
                isSuccessful = false,
                self = this;

            req.open("HEAD", request.url, true);

            console.debug("FRL CHECKING FOR EXISTENCE OF " + request.url);

            req.onload = function() {
                if (req.status < 200 || req.status > 299)
                    return;

                isSuccessful = true;

                console.debug("FRL EXISTENCE CONFIRMED FOR " + request.url);

                request.deferred.resolve(request);
            };

            req.onloadend = req.onerror = function() {
                if (isSuccessful)
                    return;

                if (remainingAttempts > 0) {
                    console.debug("FRL DOES NOT EXIST, RETRY " + request.url);
                    remainingAttempts--;
                    setTimeout(function() {
                        checkForExistence.call(self, request, remainingAttempts);
                    }, 3);
                } else {
                    console.debug("FRL DOES NOT EXIST, GIVE UP " + request.url);
                    request.deferred.reject(req);
                }
            };

            req.send();
        };

    return {
        metricsModel: undefined,
        errHandler: undefined,
        debug: undefined,
        load: function(req) {

            console.info("FRL ADD REQ");

            if (!req) {
                return Q.when(null);
            }

            req.deferred = Q.defer();

            hiveRequests.push(req);

            hiveLoadNext.call(this, req);

            return req.deferred.promise;
        },
        checkForExistence: function(req) {
            if (!req) {
                return Q.when(null);
            }

            req.deferred = Q.defer();
            checkForExistence.call(this, req, 3);

            return req.deferred.promise;
        },
        abort: function() {
            console.debug("FRL ABORT CALLED");

            for (var transferId in self.pendingP2PRequests) {

                var p2pRequest = self.pendingP2PRequests[transferId];

                Peer.cancelRequest(p2pRequest);

                delete self.pendingP2PRequests[transferId];

            }

            hiveRequests = [];

        }

    };

};


Hive.p2p.HiveFragmentLoader.prototype = new MediaPlayer.dependencies.FragmentLoader();
Hive.p2p.HiveFragmentLoader.prototype.constructor = Hive.p2p.HiveFragmentLoader;
