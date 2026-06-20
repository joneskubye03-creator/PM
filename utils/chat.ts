import { ref, push, update, remove, onChildAdded, onValue, off, get } from 'firebase/database';
import { Database } from 'firebase/database';

export function sendDriverMessage(
  database: Database,
  rideId: string,
  driverId: string,
  driverName: string,
  text: string
): void {
  const messagesRef = ref(database, `rides/${rideId}/messages`);
  push(messagesRef, {
    sender: 'driver',
    senderName: driverName,
    text,
    timestamp: Date.now(),
  });
}

export function listenForClientMessages(
  database: Database,
  rideId: string,
  driverId: string,
  onNewMessage: (message: any, messageId: string) => void
): () => void {
  const messagesRef = ref(database, `rides/${rideId}/messages`);
  const processedMessages = new Set<string>();

  const callback = (snapshot: any) => {
    const message = snapshot.val();
    const key = snapshot.key;

    if (message && key && !processedMessages.has(key)) {
      processedMessages.add(key);

      if (message.sender === 'client') {
        onNewMessage(message, key);
      }
    }
  };

  onChildAdded(messagesRef, callback);

  return () => {
    off(messagesRef, 'child_added', callback);
  };
}

export function autoDeleteReadMessages(
  database: Database,
  rideId: string,
  clientId: string,
  driverId: string
): () => void {
  return () => {};
}

export interface ConversationMeta {
  clientName?: string;
  pickupAddress?: string;
  destinationAddress?: string;
}

// Copy a ride's messages into a per-driver archive so the driver can read past
// conversations from the Inbox after a ride completes. Additive only: it reads
// the existing rides/{rideId}/messages node and writes a separate archive node.
export async function archiveConversation(
  database: Database,
  driverId: string,
  rideId: string,
  meta: ConversationMeta = {}
): Promise<void> {
  if (!driverId || !rideId) return;
  try {
    const messagesSnap = await get(ref(database, `rides/${rideId}/messages`));
    const messages = messagesSnap.exists() ? messagesSnap.val() : {};

    // Don't archive empty conversations.
    if (!messages || Object.keys(messages).length === 0) return;

    let lastMessageText = '';
    let lastTimestamp = 0;
    Object.values(messages as Record<string, any>).forEach((m: any) => {
      if (m?.timestamp && m.timestamp >= lastTimestamp) {
        lastTimestamp = m.timestamp;
        lastMessageText = m.text || '';
      }
    });

    await update(ref(database, `driver_conversations/${driverId}/${rideId}`), {
      rideId,
      clientName: meta.clientName || 'Client',
      pickupAddress: meta.pickupAddress || '',
      destinationAddress: meta.destinationAddress || '',
      lastMessage: lastMessageText,
      lastTimestamp: lastTimestamp || Date.now(),
      messages,
    });
  } catch (e) {
    // Archiving is best-effort; never let it interrupt ride completion.
  }
}

export function watchRideStatusForCleanup(
  database: Database,
  rideId: string,
  driverId?: string,
  meta?: ConversationMeta
): () => void {
  const rideRef = ref(database, `rides/${rideId}`);

  const callback = async (snap: any) => {
    const ride = snap.val();
    if (ride?.status === 'completed') {
      // Preserve the conversation for the driver's Inbox before clearing the
      // shared live node (keeps existing client-side behaviour unchanged).
      if (driverId) {
        await archiveConversation(database, driverId, rideId, meta);
      }
      remove(ref(database, `rides/${rideId}/messages`));
    }
  };

  onValue(rideRef, callback);

  return () => {
    off(rideRef, 'value', callback);
  };
}

// Live list of the driver's archived past conversations (most recent first).
export function getDriverConversations(
  database: Database,
  driverId: string,
  callback: (
    conversations: Array<{
      rideId: string;
      clientName: string;
      pickupAddress: string;
      destinationAddress: string;
      lastMessage: string;
      lastTimestamp: number;
    }>
  ) => void
): () => void {
  const convoRef = ref(database, `driver_conversations/${driverId}`);

  const listener = (snapshot: any) => {
    const list: Array<any> = [];
    snapshot.forEach((child: any) => {
      const data = child.val() || {};
      list.push({
        rideId: data.rideId || child.key || '',
        clientName: data.clientName || 'Client',
        pickupAddress: data.pickupAddress || '',
        destinationAddress: data.destinationAddress || '',
        lastMessage: data.lastMessage || '',
        lastTimestamp: data.lastTimestamp || 0,
      });
    });
    list.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    callback(list);
  };

  onValue(convoRef, listener);

  return () => {
    off(convoRef, 'value', listener);
  };
}

// Read the archived messages for a single past conversation (one-shot).
export function getArchivedMessages(
  database: Database,
  driverId: string,
  rideId: string,
  callback: (messages: Array<{ id: string; data: any }>) => void
): () => void {
  const messagesRef = ref(database, `driver_conversations/${driverId}/${rideId}/messages`);

  const listener = (snapshot: any) => {
    const messages: Array<{ id: string; data: any }> = [];
    snapshot.forEach((child: any) => {
      messages.push({ id: child.key || '', data: child.val() });
    });
    messages.sort((a, b) => a.data.timestamp - b.data.timestamp);
    callback(messages);
  };

  onValue(messagesRef, listener);

  return () => {
    off(messagesRef, 'value', listener);
  };
}

export function getAllMessages(
  database: Database,
  rideId: string,
  callback: (messages: Array<{ id: string; data: any }>) => void
): () => void {
  const messagesRef = ref(database, `rides/${rideId}/messages`);

  const listener = (snapshot: any) => {
    const messages: Array<{ id: string; data: any }> = [];
    snapshot.forEach((child: any) => {
      const msgData = child.val();
      messages.push({
        id: child.key || '',
        data: msgData,
      });
    });
    messages.sort((a, b) => a.data.timestamp - b.data.timestamp);
    callback(messages);
  };

  onValue(messagesRef, listener);

  return () => {
    off(messagesRef, 'value', listener);
  };
}

export function markMessagesAsSeen(
  database: Database,
  rideId: string
): void {
  const seenRef = ref(database, `rides/${rideId}/messagesSeen`);
  update(seenRef, {
    driverSeen: true,
    lastSeenAt: Date.now(),
  });
}

export function getUnreadCount(
  database: Database,
  rideId: string,
  driverId: string,
  callback: (count: number) => void
): () => void {
  const messagesRef = ref(database, `rides/${rideId}/messages`);
  const seenRef = ref(database, `rides/${rideId}/messagesSeen`);

  let lastSeenTimestamp = 0;
  let messagesSnapshot: any = null;

  const seenListener = (snapshot: any) => {
    const seenData = snapshot.val();
    if (seenData?.driverSeen) {
      lastSeenTimestamp = seenData.lastSeenAt || 0;
    }
    calculateUnreadCount();
  };

  const messagesListener = (snapshot: any) => {
    messagesSnapshot = snapshot;
    calculateUnreadCount();
  };

  const calculateUnreadCount = () => {
    if (!messagesSnapshot) {
      callback(0);
      return;
    }

    let unreadCount = 0;
    messagesSnapshot.forEach((child: any) => {
      const msg = child.val();
      if (msg?.sender === 'client' && msg?.timestamp > lastSeenTimestamp) {
        unreadCount++;
      }
    });
    callback(unreadCount);
  };

  onValue(seenRef, seenListener);
  onValue(messagesRef, messagesListener);

  return () => {
    off(seenRef, 'value', seenListener);
    off(messagesRef, 'value', messagesListener);
  };
}
