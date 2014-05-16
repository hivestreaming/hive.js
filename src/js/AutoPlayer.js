$(function() {
    console.info("Initializing autoplay: ", location.search)

    /*
    Discovery.init()
        .then(function(ev) {
            return Peer.init()
        })
        .then(function(ev) {
            console.log("Register done, connected peers", ev)
        })
        .catch(console.error)
*/

    video = $("#player");

    context = new Hive.gen.HiveContext();
    player = new MediaPlayer(context);

    player.startup();
    player.setAutoPlay(true);

    player.attachSource("http://dash.edgesuite.net/dash264/TestCases/1a/netflix/exMPD_BIP_TC1.mpd")
    player.attachView(video);

})
