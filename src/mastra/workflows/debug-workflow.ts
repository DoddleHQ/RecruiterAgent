import { createStep, createWorkflow } from "@mastra/core";
import z from "zod";
import {
  gmailSearchEmails,
  getEmailContent,
  sendThreadReplyEmail,
  customizeTemplate,
  sendCustomizeThreadReplyEmail,
} from "../../utils/gmail";
import { getGmailClient } from "../../OAuth/getGmailClient";

// First node: Search for emails with specific subject and extract basic info
const searchTestEmails = createStep({
  id: "search-test-emails",
  description:
    "Searches for emails with subject 'Test: testing template formatting and naming issues!' and extracts basic information",
  inputSchema: z
    .boolean()
    .describe("Boolean trigger to start the debug workflow"),
  outputSchema: z
    .array(
      z.object({
        emailId: z.string().describe("Gmail email ID"),
        messageId: z
          .string()
          .nullable()
          .describe("Message ID from email headers"),
        threadId: z.string().nullable().describe("Gmail thread ID"),
        subject: z.string().nullable().describe("Email subject"),
        from: z.string().nullable().describe("Sender email address"),
        to: z.string().nullable().describe("Recipient email address"),
        date: z.string().nullable().describe("Email date"),
        snippet: z.string().nullable().describe("Email snippet/preview"),
        senderName: z.string().nullable().describe("Extracted sender name"),
        senderEmail: z.string().nullable().describe("Extracted sender email"),
      })
    )
    .describe("Array of found test emails with basic information"),
  execute: async ({ inputData }) => {
    if (!inputData) return [];

    try {
      // Search for emails with the specific subject
      const searchResult = await gmailSearchEmails({
        userId: "me",
        q: 'subject:"Test: testing template formatting and naming issues!" -subject:"Re: Test: testing template formatting and naming issues!"',
        maxResults: 1,
      });

      const emailsInfo = [];

      for (const email of searchResult) {
        if (!email.id || !email.threadId) continue;

        try {
          // Get detailed email content
          const emailContent = await getEmailContent(email.id);

          if (!emailContent) continue;

          // Extract headers
          const headers = emailContent.payload?.headers || [];
          const messageId =
            headers.find((h) => h.name?.toLowerCase() === "message-id")
              ?.value || null;
          const subject =
            headers.find((h) => h.name?.toLowerCase() === "subject")?.value ||
            null;
          const from =
            headers.find((h) => h.name?.toLowerCase() === "from")?.value ||
            null;
          const to =
            headers.find((h) => h.name?.toLowerCase() === "to")?.value || null;
          const date =
            headers.find((h) => h.name?.toLowerCase() === "date")?.value ||
            null;

          // Extract sender name and email from "from" field
          let senderName = null;
          let senderEmail = null;

          if (from) {
            // Parse "Name <email@domain.com>" format
            const match =
              from.match(/^(.+?)\s*<(.+?)>$/) || from.match(/^(.+)$/);
            if (match) {
              if (match[2]) {
                // Format: "Name <email>"
                senderName = match[1].trim().replace(/^["']|["']$/g, ""); // Remove quotes
                senderEmail = match[2].trim();
              } else {
                // Format: just email
                senderEmail = match[1].trim();
                senderName = senderEmail.split("@")[0]; // Use email prefix as name
              }
            }
          }

          const emailInfo = {
            emailId: email.id,
            messageId,
            threadId: email.threadId,
            subject,
            from,
            to,
            date,
            snippet: emailContent.snippet || null,
            senderName,
            senderEmail,
          };

          emailsInfo.push(emailInfo);
        } catch (error) {
          console.error(`Error processing email ${email.id}:`, error);
          continue;
        }
      }

      return emailsInfo;
    } catch (error) {
      console.error("Error searching for emails:", error);
      return [];
    }
  },
});

// Second node: Send thread reply emails using the extracted data
const sendTestReplyEmails = createStep({
  id: "send-test-reply-emails",
  description:
    "Sends thread reply emails using the extracted email data and sendThreadReplyEmail function",
  inputSchema: z
    .array(
      z.object({
        emailId: z.string().describe("Gmail email ID"),
        messageId: z
          .string()
          .nullable()
          .describe("Message ID from email headers"),
        threadId: z.string().nullable().describe("Gmail thread ID"),
        subject: z.string().nullable().describe("Email subject"),
        from: z.string().nullable().describe("Sender email address"),
        to: z.string().nullable().describe("Recipient email address"),
        date: z.string().nullable().describe("Email date"),
        snippet: z.string().nullable().describe("Email snippet/preview"),
        senderName: z.string().nullable().describe("Extracted sender name"),
        senderEmail: z.string().nullable().describe("Extracted sender email"),
      })
    )
    .describe("Array of found test emails with basic information"),
  outputSchema: z.string().describe("Results of sending thread reply emails"),
  execute: async ({ inputData }) => {
    if (!inputData || inputData.length === 0) {
      return "";
    }

    for (const emailInfo of inputData) {
      if (
        !emailInfo.threadId ||
        !emailInfo.messageId ||
        !emailInfo.senderEmail
      ) {
        continue;
      }

      const mobileDevQues = [
  {
    question: "Can you describe your experience with React Native and how you've used it in previous projects?",
    type: 'text-based'
  },
  {
    question: 'How do you optimize the performance of a React Native application?',
    type: 'text-based'
  },
  {
    question: 'Write a JavaScript function to implement a simple Redux store with a single reducer.',
    type: 'example-based',
    example: 'function reducer(state = {}, action) { switch (action.type) { ... } }'
  },
  {
    question: 'What is the difference between JavaScript and TypeScript?',
    type: 'multiple-choice',
    options: [
      'JavaScript is a dynamically-typed language, while TypeScript is statically-typed',
      'JavaScript is a statically-typed language, while TypeScript is dynamically-typed',
      'JavaScript and TypeScript are both dynamically-typed languages'
    ]
  },
  {
    question: "Can you explain the concept of a 'mobile-first' design approach and how you've implemented it in previous projects?",
    type: 'text-based'
  },
  {
    question: 'How do you handle errors and exceptions in a React Native application?',
    type: 'text-based'
  },
  {
    question: 'What is the purpose of using Git and GitHub in software development?',
    type: 'riddle-based'
  },
  {
    question: 'Can you describe a situation where you had to integrate a third-party library or service into a React Native application?',
    type: 'text-based'
  }
]
         

      const customizedTemplate = customizeTemplate({
          templateId: "templates-pre-questionnaire-details",
          customItems: mobileDevQues,
        })


      if(!customizedTemplate) {
       console.log("Failed to customize template")
        continue;
      }

      try {
        await sendCustomizeThreadReplyEmail({
          name: emailInfo.senderName || "User",
          position: "Mobile App Developer",
          userEmail: emailInfo.senderEmail,
          subject: emailInfo.subject,
          threadId: emailInfo.threadId,
          emailId: emailInfo.emailId,
          inReplyTo: emailInfo.messageId,
          references: [emailInfo.messageId],
          templateMailBody: customizedTemplate,
        });
      } catch (error) {
        console.error("Error sending reply:", error);
      }
    }

    return `Sent Mail Successfully!`;
  },
});

// Create the debug workflow
const debugWorkflow = createWorkflow({
  id: "debug-workflow",
  description: "Debug workflow to search test emails and send thread replies",
  inputSchema: z
    .boolean()
    .describe("Boolean trigger to start the debug workflow"),
  outputSchema: z
    .object({
      totalEmails: z.number().describe("Total number of emails processed"),
      successfulReplies: z
        .number()
        .describe("Number of successful replies sent"),
      failedReplies: z.number().describe("Number of failed replies"),
      replyResults: z
        .array(
          z.object({
            emailId: z.string().describe("Original email ID"),
            threadId: z.string().nullable().describe("Thread ID"),
            success: z
              .boolean()
              .describe("Whether reply was sent successfully"),
            replyMessageId: z
              .string()
              .nullable()
              .describe("ID of the sent reply message"),
            error: z.string().nullable().describe("Error message if failed"),
            senderName: z
              .string()
              .nullable()
              .describe("Name of original sender"),
            senderEmail: z
              .string()
              .nullable()
              .describe("Email of original sender"),
          })
        )
        .describe("Results of reply attempts"),
    })
    .describe("Final debug workflow output with reply results"),
  steps: [searchTestEmails, sendTestReplyEmails],
  retryConfig: {
    attempts: 3,
    delay: 2000,
  },
})
  .then(searchTestEmails)
  .then(sendTestReplyEmails);

// Commit the workflow
debugWorkflow.commit();

export { debugWorkflow };
