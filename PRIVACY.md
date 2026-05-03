# Discord Chat Reader Privacy Policy

Discord Chat Reader is a Chrome extension that reads newly arrived Discord Web chat messages aloud in the browser.

## Data Handling

- This extension processes message text displayed on Discord Web only for the purpose of reading new messages aloud.
- User settings such as enable or disable state, speech engine, voice, VOICEVOX speaker, rate, pitch, volume, and filtering options are stored locally using Chrome extension storage.
- When the browser speech engine is selected, this extension does not send message contents or settings to any external server operated by the developer.
- When Chrome Built-in AI text review is enabled and available, message text may be processed locally by Chrome's on-device language model before speech playback.
- When the local VOICEVOX Engine speech engine is selected, message text is sent only to the locally running VOICEVOX Engine endpoint configured by the user, normally `http://127.0.0.1:50021`.
- When the WEB VOICEVOX API speech engine is selected and the user explicitly enables external text-to-speech, message text is sent to `api.tts.quest` to synthesize speech.
- This extension does not sell, transfer, or use user data for advertising, profiling, analytics, or creditworthiness decisions.

## Permissions

- `storage`: Used to save reader settings.
- `tabs`: Used to identify the active Discord tab for manual read actions and to open settings or help pages.
- `offscreen`: Used to play speech while the Discord tab is in the background.
- Host permissions for `discord.com`, `ptb.discord.com`, and `canary.discord.com`: Used to detect and read messages shown in Discord Web.
- Host permissions for `127.0.0.1` and `localhost`: Used to connect to a local VOICEVOX Engine when selected.
- Host permissions for `tts.quest`: Used only when WEB VOICEVOX API speech is selected and external text-to-speech is explicitly enabled.

## Contact

For support, please visit:

https://github.com/tanabe1478/discord-reading
