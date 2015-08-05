var callback = function(message){console.log(message);}; // holds the user's callback for a global scope
var callICEConnected = false;
var callPurposefullyEnded = false; // used to determine whether the user ended the call or the call was ended from somewhere else outside
var callTimeout = null; // function that will run if there is no call established
var conferenceIdNumber = "1008";
var conferenceUsername = "FreeSWITCH User";
var toDisplayDisconnectCallback = true; // if a call is dropped only display the error the first time
var voiceBridge = extension = "3500";
var wasCallSuccessful = false; // when the websocket connection is closed this determines whether a call was ever successfully established
var stream;
var videoTag = null;

// save a copy of the hangup function registered for the verto object
var oldHangup = $.verto.prototype.hangup;
// overwrite the verto hangup handler with my own handler
$.verto.prototype.hangup = function(callID, userCallback) {
	console.log("call state callbacks - bye");
	if (userCallback) {
		callback = userCallback;
	}
	callActive = false;

	if (cur_call) {
		console.log('call ended ' + cur_call.audioStream.currentTime); // the duration of the call
		if (callPurposefullyEnded === true) { // the user ended the call themself
			callback({'status':'ended'});
		} else {
			callback({'status':'failed', 'errorcode': 1005}); // Call ended unexpectedly
		}
		clearTimeout(callTimeout);
		cur_call = null;
	} else {
		console.log('bye event already received');
	}
	// call the original hangup procedure
	return oldHangup.apply(this, arguments);
}

// main entry point to making a verto call
function callIntoConference(voiceBridge, conferenceUsername, conferenceIdNumber, userCallback, videoTag) {
	window.videoTag = videoTag;
	// stores the user's callback in the global scope
	if (userCallback) {
		callback = userCallback;
	}
	if(!isLoggedIntoVerto()) { // start the verto log in procedure
		// runs when a web socket is disconnected
		callbacks.onWSClose = function(v, success) {
			if(wasCallSuccessful) { // a call was established through the websocket
				if(toDisplayDisconnectCallback) { // will only display the error the first time
					// the connection was dropped in an already established call
					console.log("websocket disconnected");
					callback({'status':'failed', 'errorcode': 1001}); // WebSocket disconnected
					toDisplayDisconnectCallback = false;
				}
			} else {
				// this callback was triggered and a call was never successfully established
				console.log("websocket connection could not be established");
				callback({'status':'failed', 'errorcode': 1002}); // Could not make a WebSocket connection
			}
		}
		// runs when the websocket is successfully created
		callbacks.onWSLogin = function(v, success) {
			cur_call = null;
			ringing = false;
			console.log("Inside onWSLogin");

			if (success) {
				console.log("starting call");
				toDisplayDisconnectCallback = true; // yes, display an error if the socket closes
				wasCallSuccessful = true; // yes, a call was successfully established through the websocket
				webrtc_call(voiceBridge, conferenceUsername, conferenceIdNumber, callback);
			} else {
				callback({'status':'failed', 'errorcode': '10XX'}); // eror logging verto into freeswitch
			}
		}
		// set up verto
		$.verto.init({}, init(videoTag));
	} else {
		console.log("already logged into verto, going straight to making a call");
		webrtc_call(voiceBridge, conferenceUsername, conferenceIdNumber, callback);
	}
}

function configStuns(callbacks, callback, videoTag) {
	console.log("Fetching STUN/TURN server info for Verto initialization");
	var stunsConfig = {};
	$.ajax({
		dataType: 'json',
		url: '/bigbluebutton/api/stuns/'
	}).done(function(data) {
		console.log("ajax request done");
		console.log(data);
		stunsConfig['stunServers'] = ( data['stunServers'] ? data['stunServers'].map(function(data) {
			return {'url': data['url']};
		}) : [] );
		stunsConfig['turnServers'] = ( data['turnServers'] ? data['turnServers'].map(function(data) {
			return {
				'urls': data['url'],
				'username': data['username'],
				'credential': data['password']
			};
		}) : [] );
		stunsConfig = stunsConfig['stunServers'].concat(stunsConfig['turnServers']);
		console.log("success got stun data, making verto");
		makeVerto(callbacks, stunsConfig, videoTag);
	}).fail(function(data, textStatus, errorThrown) {
		// BBBLog.error("Could not fetch stun/turn servers", {error: textStatus, user: callerIdName, voiceBridge: conferenceVoiceBridge});
		callback({'status':'failed', 'errorcode': 1009});
		return;
	});
}

function docall(extension, conferenceUsername, conferenceIdNumber, callbacks) {
	console.log(extension + ", " + conferenceUsername + ", " + conferenceIdNumber);

	if (cur_call) { // only allow for one call
		console.log("Quitting: Call already in progress");
		return;
	}
	// determine the resolution the user chose for webcam video
	my_check_vid_res();
	outgoingBandwidth = "default";
	incomingBandwidth = "default";

	cur_call = verto.newCall({
		destination_number: extension,
		caller_id_name: conferenceUsername,
		caller_id_number: conferenceIdNumber,
		outgoingBandwidth: outgoingBandwidth,
		incomingBandwidth: incomingBandwidth,
		useVideo: true,
		useStereo: true,
		useCamera: true,
		useMic: true,
		dedEnc: false,
		mirrorInput: false
	});

	if (callbacks != null) { // add user supplied callbacks to the current call
		cur_call.rtc.options.callbacks = $.extend(cur_call.rtc.options.callbacks, callbacks);
	}
}

// return the webcam resolution that the user has selected
function getChosenWebcamResolution() {
	var videoConstraints = getAllPresetVideoResolutions(); // retrieve all resolutions
	var selectedVideo = null;
	for(var i in videoConstraints) {
		selectedVideo = videoConstraints[i];
		if($("#webcamQuality_"+i).is(':checked')) { // compare against all resolutions
			break;
		}
	}
	return selectedVideo;
}

// receives a video resolution profile, and converts it into a constraints format for getUserMedia
function getWebcamConstraintsFromResolution(resolution) {
	return {
		"audio": false,
		"video": {
			"mandatory": {
				"minWidth": resolution.constraints.minWidth,
				"maxWidth": resolution.constraints.maxWidth,
				"minHeight": resolution.constraints.minHeight,
				"maxHeight": resolution.constraints.maxHeight,
				"minFrameRate": resolution.constraints.minFrameRate
			},
			"optional": []
		}
	};
}

// check if logged into verto by seeing if there is a ready websocket connection
function isLoggedIntoVerto() {
	return (verto != null ? (ref = verto.rpcClient) != null ? ref.socketReady() : void 0 : void 0);
}

// overwrite and substitute my own init function
init = function(videoTag) {
	cur_call = null;
	share_call = null;
	incomingBandwidth = "default";
	configStuns(callbacks, callback, videoTag);
}

// checks whether Google Chrome or Firefox have the WebRTCPeerConnection object
function isWebRTCAvailable() {
	return (typeof window.webkitRTCPeerConnection !== 'undefined' || typeof window.mozRTCPeerConnection !== 'undefined');
}

// exit point for conference
function leaveWebRTCVoiceConference() {
	console.log("Leaving the voice conference");
	webrtc_hangup();
}

function make_call(voiceBridge, conferenceUsername, conferenceIdNumber, userCallback, server, recall) {
	if (userCallback) {
		callback = userCallback;
	}
	callPurposefullyEnded = false;

	// after 15 seconds if a call hasn't been established display error, hangup and logout of verto
	callTimeout = setTimeout(function() {
		console.log('Ten seconds without updates sending timeout code');
		callback({'status':'failed', 'errorcode': 1006}); // Failure on call
		if (verto != null) {
			verto.hangup();
			verto.logout();
			verto = null;
		}
		cur_call = null;
	}, 10000*1.5);

	var myRTCCallbacks = {
		onError: function(vertoErrorObject, errorMessage) {
			console.error("custom callback: onError");
			console.log("current verto");
			console.error(vertoErrorObject);
			console.error("ERROR:");
			console.error(errorMessage);
			if(errorMessage.name === "PermissionDeniedError") { // user denied access to media peripherals
				console.error("User denied permission/access to hardware");
				console.error("getUserMedia: failure - ", errorMessage);
				callback({'status': 'mediafail', 'cause': errorMessage});
			}
			cur_call.hangup({cause: "Device or Permission Error"});
			clearTimeout(callTimeout);
		},
		onICEComplete: function(self, candidate) { // ICE candidate negotiation is complete
			console.log("custom callback: onICEComplete");
			console.log('Received ICE status changed to completed');
			if (callICEConnected === false) {
				callICEConnected = true;
				if (callActive === true) {
					callback({'status':'started'});
				}
				clearTimeout(callTimeout);
			}
		},
		onStream: function(rtc, stream) { // call has been established
			console.log("getUserMicMedia: success");
			callback({'status':'mediasuccess'});
			console.log("custom callback: stream started");
			callActive = true;
			console.log('BigBlueButton call accepted');

			if (callICEConnected === true) {
				callback({'status':'started'});
			} else {
				callback({'status':'waitingforice'});
			}
			clearTimeout(callTimeout);
		}
	};

	if(isLoggedIntoVerto()) {
		console.log("Verto is logged into FreeSWITCH, socket is available, making call");
		callICEConnected = false;

		docall(voiceBridge, conferenceUsername, conferenceIdNumber, myRTCCallbacks);

		if(recall === false) {
			console.log('call connecting');
			callback({'status': 'connecting'});
		} else {
			console.log('call connecting again');
		}

		callback({'status':'mediarequest'});
	} else {
		console.error("Verto is NOT logged into FreeSWITCH, socket is NOT available, abandoning call request");
	}
}

function makeVerto(callbacks, stunsConfig, videoTag) {
	var vertoPort = "8082";
	var hostName = window.location.hostname;
	var socketUrl = "wss://" + hostName + ":" + vertoPort;
	var login = "1008";
	var password = "alpine";
	var minWidth = "320";
	var minHeight = "180";
	var maxWidth = "320";
	var maxHeight = "180";

	console.log("stuns info is");
	console.log(stunsConfig);

	check_vid_res();
	// create verto object and log in
	verto = new $.verto({
		login: login,
		passwd: password,
		socketUrl: socketUrl,
		// tag: "webcam",
		tag: videoTag,
		ringFile: "sounds/bell_ring2.wav",
		loginParams: {foo: true, bar: "yes"},
		videoParams: {
			"minWidth": minWidth,
			"minHeight": minHeight
		},
		iceServers: stunsConfig, // use user supplied stun configuration
		// iceServers: true, // use stun, use default verto configuration
	}, callbacks);
	refresh_devices();
}

// sets verto to begin using the resolution that the user selected
function my_check_vid_res() {
	var selectedVideoConstraints = getChosenWebcamResolution();
	my_real_size(selectedVideoConstraints);

	if (verto) {
		verto.videoParams({
			"minWidth": selectedVideoConstraints.constraints.minWidth,
			"minHeight": selectedVideoConstraints.constraints.minHeight,
			"maxWidth": selectedVideoConstraints.constraints.maxWidth,
			"maxHeight": selectedVideoConstraints.constraints.maxHeight,
			"minFrameRate": selectedVideoConstraints.constraints.minFrameRate,
			"vertoBestFrameRate": selectedVideoConstraints.constraints.vertoBestFrameRate
		});
	}
}

function my_real_size(selectedVideoConstraints) {
	$("#" + window.videoTag).width(selectedVideoConstraints.constraints.maxWidth);
	$("#" + window.videoTag).height(selectedVideoConstraints.constraints.maxHeight);
	console.log("video size changed to natural default");
}

var RTCPeerConnectionCallbacks = {
	iceFailed: function(e) {
		console.log('received ice negotiation failed');
		callback({'status':'failed', 'errorcode': 1007}); // Failure on call
		cur_call = null;
		verto.hangup();
		verto = null;
		clearTimeout(callTimeout);
	}
};

function webrtc_call(voiceBridge, conferenceUsername, conferenceIdNumber, userCallback) {
	if (userCallback) {
		callback = userCallback;
	}
	console.log("webrtc_call\n"+voiceBridge + ", " + conferenceUsername + ", " + conferenceIdNumber + ", " + callback);

	if(!isWebRTCAvailable()) {
		callback({'status': 'failed', 'errorcode': 1003}); // Browser version not supported
		return;
	}

	var server = window.document.location.hostname;
	console.log("user " + conferenceUsername + " calling to " +	voiceBridge);
	if (isLoggedIntoVerto()) {
		make_call(voiceBridge, conferenceUsername, conferenceIdNumber, callback, "", false);
	}
}

function webrtc_hangup(userCallback) {
	if (userCallback) {
		callback = userCallback;
	}
	callPurposefullyEnded = true;
	console.log("Hanging up current session");
	verto.hangup(false, callback);
}

// supplement my own that insert my own button and handler
$(document).ready(function() {
	initUIHandlers();
});

// retrieves the camera resolution the user selected
// displays a local feed of the user's webcam
function doWebcamPreview(onSuccess, onFailure, videoTag) {
	var selectedVideoConstraints = getChosenWebcamResolution(); // this is the video profile the user chose
	my_real_size(selectedVideoConstraints);
	selectedVideoConstraints = getWebcamConstraintsFromResolution(selectedVideoConstraints); // convert to a valid constraints object

	console.log("screen constraints", selectedVideoConstraints)
	if(!!stream) {
		$("#" + videoTag).src = null;
		stream.stop();
	}
	navigator.getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
	navigator.getUserMedia(selectedVideoConstraints, function(stream) {
		window.stream = stream;
		$("#" + videoTag).get(0).src = URL.createObjectURL(stream);
		$("#" + videoTag).get(0).play();
		$("#" + videoTag).show();
	}, function(error) {
		console.error(JSON.stringify(error, null, '\t'));
		return callback(error);
	});
}

function checkSupport(callback) {
	if(!isWebRTCAvailable()) {
		callback({'status': 'failed', 'errorcode': 1003}); // Browser version not supported
	}

	if (!navigator.getUserMedia) {
		navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
	}

	if (!navigator.getUserMedia){
		callback({'status': 'failed', 'errorcode': '10XX'}); // getUserMedia not supported in this browser
	}
}
