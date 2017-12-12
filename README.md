# Hive.js

Hive.js is an extension to dash.js that enables distributed caching of video fragments
using direct browser-to-browser communication over WebRTC.

# Running a local demo

## Start the server

  * Make sure you have python 2.7 available
  * Install pip, e.g. `apt-get install python-pip`
  * Setup virtualenv and create an environment for hive:
    - `virtualenv ~/.virtualenvs/hive -p python2.7`
    - `source ~/.virtualenvs/hive/bin/activate`

  * Install the service dependencies
    - pip install gunicorn
    - pip install Flask-Sockets

  * Start the server
    - `cd service`
    - `gunicorn -w 1 -k flask_sockets.worker main:app`

The demo page is now available at http://localhost:8000/demo/index.html.
