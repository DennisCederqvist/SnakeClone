import { MultiplayerApi } from './MultiplayerApi.js';

//const api = new MultiplayerApi('ws://kontoret.onvo.se/multiplayer');

const api = new MultiplayerApi(`ws${location.protocol === 'https:' ? 's' : ''}://${location.host}/multiplayer`);

const hostButton = document.getElementById('hostButton');
const joinButton = document.getElementById('joinButton');
const joinSessionInput = document.getElementById('joinSessionInput');
const joinNameInput = document.getElementById('joinNameInput');
const sendButton = document.getElementById('sendButton');
const status = document.getElementById('status');

function initiate() {

	hostButton.addEventListener('click', () => {




		api.host()
			.then((result) => {
				status.textContent = `Hosted session with ID: ${result.session} with clientId: ${result.clientId}`;
			})
			.catch((error) => {
				console.error('Error hosting session:', error);
			});




	});

	joinButton.addEventListener('click', () => {


		api.join(joinSessionInput.value, { name: joinNameInput.value })
			.then((result) => {
				status.textContent = `Joined session: ${result.session} with clientId: ${result.clientId}`;
			})
			.catch((error) => {
				console.error('Error joining session:', error);
			});




	});

	sendButton.addEventListener('click', () => {


		api.game({ msg: "Hello from client!" });

	});


	const unsubscribe = api.listen((event, messageId, clientId, data) => {

		status.textContent = `Received event "${event}" with messageId: "${messageId}" from clientId: "${clientId}" and data: ${JSON.stringify(data)}`;

	});

}

window.addEventListener('load', () => {
	initiate();
});
