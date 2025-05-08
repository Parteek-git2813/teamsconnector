const express = require('express');
const { BotFrameworkAdapter } = require('botbuilder');
const { AzureOpenAI } = require('openai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3978;

// Parse JSON bodies
app.use(express.json());

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`Received request: ${req.method} ${req.url}`);
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  next();
});

const adapter = new BotFrameworkAdapter({
  appId: process.env.MICROSOFT_APP_ID,
  appPassword: process.env.MICROSOFT_APP_PASSWORD
});

// Azure Open AI credentials from .env
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;
const API_VERSION = process.env.OPENAI_API_VERSION || '2024-05-01-preview';

// Initialize AzureOpenAI client with API key
const client = new AzureOpenAI({
  endpoint: AZURE_OPENAI_ENDPOINT,
  apiKey: AZURE_OPENAI_API_KEY,
  deployment: AZURE_OPENAI_DEPLOYMENT,
  apiVersion: API_VERSION
});

// Store conversation history in memory (keyed by user ID)
const conversationHistory = {};

// Bot version for info command
const BOT_VERSION = '1.0.0';

app.post('/api/messages', (req, res) => {
  console.log('Processing activity...');
  adapter.processActivity(req, res, async (context) => {
    console.log('Activity received:', JSON.stringify(context.activity, null, 2));
    if (context.activity.type === 'message') {
      let userMessage = context.activity.text.trim();
      const userId = context.activity.from.id;
      console.log('User message:', userMessage, 'User ID:', userId);

      // Initialize conversation history for the user if it doesn't exist
      if (!conversationHistory[userId]) {
        conversationHistory[userId] = [
          { role: 'system', content: 'You are a helpful assistant.' }
        ];
      }

      // Handle commands
      const commandMatch = userMessage.match(/^(\w+)\b/);
      const command = commandMatch ? commandMatch[1].toLowerCase() : null;

      if (command === 'summarize') {
        // Summarize last 5 messages
        const recentMessages = conversationHistory[userId]
          .filter(msg => msg.role === 'user' || msg.role === 'assistant')
          .slice(-5);
        if (recentMessages.length === 0) {
          await context.sendActivity('No messages to summarize.');
          return;
        }
        const summaryPrompt = `Summarize the following conversation in 2-3 sentences:\n${recentMessages.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`;
        try {
          const response = await client.chat.completions.create({
            messages: [{ role: 'user', content: summaryPrompt }],
            temperature: 0.7,
            model: ''
          });
          const summary = response.choices[0]?.message?.content || 'Unable to generate summary.';
          await context.sendActivity(summary);
        } catch (err) {
          console.error('Error summarizing:', err.message);
          await context.sendActivity('Sorry, something went wrong while summarizing.');
        }
        return;
      } else if (command === 'clear') {
        // Clear conversation history
        conversationHistory[userId] = [
          { role: 'system', content: 'You are a helpful assistant.' }
        ];
        await context.sendActivity('Conversation history cleared.');
        return;
      } else if (command === 'info') {
        // Display bot info
        const infoMessage = `Teams Chatbot v${BOT_VERSION}\nPowered by Auxiliobits.\nCommands: summarize, clear, info`;
        await context.sendActivity(infoMessage);
        return;
      }

      // Add the user's message to the conversation history
      conversationHistory[userId].push({ role: 'user', content: userMessage });

      // Limit the history to the last 10 messages to avoid token limits
      if (conversationHistory[userId].length > 10) {
        conversationHistory[userId] = conversationHistory[userId].slice(-10);
      }

      try {
        // Call Azure Open AI for non-command messages
        const response = await client.chat.completions.create({
          messages: conversationHistory[userId],
          temperature: 0.7,
          model: ''
        });

        console.log('Azure Open AI response:', JSON.stringify(response, null, 2));

        // Extract the response from Azure Open AI
        const botReply = response.choices[0]?.message?.content || 'No response from Azure Open AI.';

        // Add the bot's response to the conversation history
        conversationHistory[userId].push({ role: 'assistant', content: botReply });

        await context.sendActivity(botReply);
      } catch (err) {
        console.error('Error in processing:', err.message);
        if (err.response) {
          console.error('Azure Open AI error response:', err.response?.data || err.response);
        }
        await context.sendActivity('Sorry, something went wrong while communicating with the AI.');
      }
    } else {
      console.log('Non-message activity received:', context.activity.type);
      if (context.activity.type === 'conversationUpdate') {
        console.log('Conversation update received, ignoring...');
      }
    }
  }).catch(err => {
    console.error('Adapter error:', err.message);
  });
});

app.listen(port, () => {
  console.log(`Bot listening on http://localhost:${port}/api/messages`);
});