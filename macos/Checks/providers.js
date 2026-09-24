// Private test fixture. This module is never included in the production app.
export function fixtures(store) {
  return {
    embed: async (_config, texts) => texts.map(text => [1, 1 + text.length % 3]),
    checkUpdates: async () => ({ currentVersion: '0.5.0-alpha.1', latestVersion: '0.5.0-alpha.2', updateAvailable: true, prerelease: true, url: 'https://github.com/Coke1120/genmail/releases/tag/v0.5.0-alpha.2', checkedAt: new Date().toISOString() }),
    verifySmtp: async () => {},
    oauthFinish: async (provider, { config }) => ({ provider, ...config, email: `oauth-${provider}@example.com`, accessToken: 'fixture' }),
    fetchProviderMessages: async () => [],
    fetchImapPage: async (mail, { folder }) => ({ messages: [{ id: `history-${folder}`, fromEmail: mail.email, to: 'friend@example.com', body: 'Please share your thoughts on the timetable when you have a moment. Thank you for reviewing this.', date: new Date(Date.now() - 3600000).toISOString(), folder, subject: 'History fixture', labels: [], read: true }], nextCursor: null }),
    runModel: async (ai, action) => action === 'style' ? { text: 'Friendly, direct, and concise.', usage: { total_tokens: 150 } } : 'Fixture response',
    listImapFolders: async () => [{ id: 'INBOX', name: 'Inbox', kind: 'inbox' }, { id: 'Projects', name: 'Projects', kind: 'folder' }],
    organizeImapMessage: async (mail, message, destination) => ({ remoteId: message.remoteId || message.id, providerFolderId: destination.id, providerFolderName: destination.name, folder: destination.kind === 'inbox' ? 'inbox' : 'archive' }),
    fetchImapMessages: async mail => [{ id: 'shared-inbox-id', fromName: 'Fixture', fromEmail: 'sender@example.com', to: mail.email, subject: mail.email, body: 'Owned by ' + mail.email, date: '2026-09-23T12:00:00Z', folder: 'inbox', read: false, starred: false, labels: [] }],
    refreshMail: async value => value,
    listCalendars: async () => [{ id: 'primary', name: 'Personal', canWrite: true }, { id: 'readonly', name: 'Holidays', canWrite: false }],
    listCalendarEvents: async connection => (store.getSettings().fixtureEvents || []).filter(event => event.provider === connection.provider),
    createCalendarEvent: async (connection, value) => {
      const events = store.getSettings().fixtureEvents || [];
      const event = { ...value, id: value.requestId, provider: connection.provider };
      store.setSettings({ fixtureEvents: [...events, event] });
      return event;
    },
    sendSmtpMessage: async () => {
      const attempts = (store.getSettings().fixtureSends || 0) + 1;
      store.setSettings({ fixtureSends: attempts });
      if (attempts === 1) throw new Error('Simulated uncertain delivery');
      return { messageId: 'fixture-message' };
    },
  };
}
