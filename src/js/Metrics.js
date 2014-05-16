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

var Metrics = (function() {
    self = {}

    var validTraffic = [
      "reqN",
      "srcReqN",
      "srcRespN",
      "srcRespErrN",
      "srcRespQt",
      "p2pSubReqN",
      "p2pSubRespN",
      "p2pSubRespErrN",
      "p2pSubRespQt",
      "p2pAgenTrafficSuccessQt" // expected for plotting
    ]

    var validMetrics = [
      "videoBufN", // number of buffering events
      "audioBufN"
    ]

    var validMetricGauges = [
      "videoAvgBufQt", // buffer length in milliseconds
      "audioAvgBufQt"
    ]

    self.startTs = new Date().toISOString().slice(0,10)

    self.summary = {}
    self.summary.traffic = {}
    self.summary.metrics = {}

    // setup the snapshot
    self.snapshot = {}

    self.snapshot.eventId = {
        partnerId: "9001",
        customerId: "hive-browser",
        contentId: null // rotate daily
    }

    self.snapshot.streamInfo = {}

    self.metricGauges = {}

    self.reset = function() {
        self.snapshot.metrics = {}
        self.snapshot.traffic = {} 
        self.snapshot.traffic.total = {}

        // reset all metrics we are using, they should always be part
        // of the snapshot
        for(var v in validTraffic) {
            self.snapshot.traffic.total[validTraffic[v]] = 0
        }

        for(var v in validMetrics) {
            self.snapshot.metrics[validMetrics[v]] = 0
        }

        for(var v in validMetricGauges) {
            self.metricGauges[validMetricGauges[v]] = []
        }
    }

    self.reset()

    self.increase = function(type, metric, amount) {
        if(type == 'traffic') {
            var value = self.snapshot.traffic.total[metric] || 0
            self.snapshot.traffic.total[metric] = value + amount

            var summaryValue = self.summary.traffic[metric] || 0
            self.summary.traffic[metric] = summaryValue + amount

        } else if(type == 'metrics') {
            var value = self.snapshot.metrics[metric] || 0
            self.snapshot.metrics[metric] = value + amount
        } else {
          console.warn("Invalid metric type", type, metric)
        }

        self.renderSummary()
    }

    self.record = function(type, metric, amount) {
        if(type == 'metrics') {
            self.metricGauges[metric].push(amount)
        } else {
            console.warn("Invalid gauge type", type, metric)
        }
    }

    self.renderSummary = function() {
        var table = $("#metrics-summary")
        table.empty()

        var p2pQt = self.summary.traffic["p2pSubRespQt"] || 0
        var cdnQt = self.summary.traffic["srcRespQt"] || 0

        table.append(
          "<tr> \
          <td>Source</td> \
          <td>" + self.summary.traffic["srcReqN"] + "/" + self.summary.traffic["srcRespN"] + "</td> \
          <td>" + self.summary.traffic["srcRespQt"] + "</td> \
          <td>" + self.summary.traffic["srcRespErrN"] + "</td> \
          </tr>"
        ) 
 
        table.append(
          "<tr> \
          <td>P2P</td> \
          <td>" + self.summary.traffic["p2pSubReqN"] + "/" + self.summary.traffic["p2pSubRespN"] + "</td> \
          <td>" + self.summary.traffic["p2pSubRespQt"] + "</td> \
          <td>" + self.summary.traffic["p2pSubRespErrN"] + "</td> \
          </tr>"
        ) 

        var savings = (p2pQt/(cdnQt+p2pQt))*100
        $("#metrics-savings").html(savings.toFixed(2))
    }

    return self
})()
