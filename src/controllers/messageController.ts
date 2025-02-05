import {
  queryEmbeddings,
  getLastConversation,
  setLastConversation,
} from '../services/queryService.js';
import { sendMessageToWhatsApp, markMessageAsRead } from '../services/whatsappService.js';
import { collectFeedback } from '../services/feedbackService.js';
import { detectLanguage } from '../services/languageService.js';

const processedMessages = new Set<string>();

function sendFeedbackRequestAfterDelay(userId: string, language: string) {
  setTimeout(() => {
    collectFeedback(userId, language).catch((error) => {
      console.error('Error sending feedback request:', error);
    });
  }, 10 * 60 * 1000); // 10 minutes delay
}

export async function handleIncomingMessage(body: any) {
  console.log('Entering handleIncomingMessage');
  try {
    // Check if this is a status update
    if (body.entry?.[0]?.changes?.[0]?.value?.statuses) {
      handleStatusUpdate(body);
      return;
    }

    // Validate incoming message structure
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'text') {
      console.error('Invalid or unsupported message format');
      return;
    }

    const messageId = message.id;
    const userMessage = message.text.body;
    const userId = message.from;

    console.log(`Processing message: ${messageId} from user: ${userId}, type: ${typeof userId}`);

    // Check if the message has already been processed
    if (processedMessages.has(messageId)) {
      console.log(`Message ${messageId} has already been processed. Skipping.`);
      return;
    }

    // Add the message ID to the set of processed messages
    processedMessages.add(messageId);

    console.log(`Received message: "${userMessage}"`);

    let userLanguage: string, lastConversation: any;
    try {
      userLanguage = await detectLanguage(userMessage);
      lastConversation = getLastConversation(userId);
    } catch (error) {
      console.error('Error in language detection or getting last conversation:', error);
      userLanguage = 'en'; // Default to English
      lastConversation = null;
    }

    try {
      const aiResponse = await queryEmbeddings(userMessage, {
        context: lastConversation,
        language: userLanguage,
        userId,
      });
      console.log(`AI Response: "${aiResponse.answer}"`);

      await sendMessageToWhatsApp(userId, aiResponse.answer);
      await markMessageAsRead(messageId);

      // Update the last conversation for this user
      setLastConversation(userId, {
        query: userMessage,
        response: aiResponse.answer,
      });

      // Send feedback request after delay
      sendFeedbackRequestAfterDelay(userId, userLanguage);

      // Remove the message ID from the set after processing
      processedMessages.delete(messageId);

      console.log(`Successfully processed message: ${messageId}`);
    } catch (error) {
      console.error('Error processing WhatsApp message:', error);
      await sendMessageToWhatsApp(
        userId,
        "I'm experiencing technical difficulties. Please try again later.",
      );
      // Remove the message ID from the set in case of error
      processedMessages.delete(messageId);
    }
  } catch (error) {
    console.error('Unexpected error in handleIncomingMessage:', error);
  }
  console.log('Exiting handleIncomingMessage');
}

function handleStatusUpdate(body: any) {
  const status = body.entry[0].changes[0].value.statuses[0];
  console.log(`Message status update: ${status.id} - ${status.status}`);
}
