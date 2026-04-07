import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';

// Register a monospace font for code blocks
Font.register({
  family: 'Courier',
  src: 'https://fonts.gstatic.com/s/courierprime/v7/u-450q2lgwslOqpF_6gQ8kELWwZjW-_-tvg.ttf',
});

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    fontFamily: 'Helvetica',
    color: '#1a1a2e',
    backgroundColor: '#ffffff',
  },
  header: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#3b82f6',
    borderBottomStyle: 'solid',
  },
  title: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#0f172a',
    marginBottom: 8,
  },
  meta: {
    fontSize: 9,
    color: '#64748b',
    marginBottom: 2,
  },
  messageContainer: {
    marginBottom: 16,
  },
  userMessage: {
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 4,
  },
  assistantMessage: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
    borderLeftStyle: 'solid',
  },
  roleLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#3b82f6',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  userRoleLabel: {
    color: '#2563eb',
  },
  assistantRoleLabel: {
    color: '#7c3aed',
  },
  messageContent: {
    fontSize: 10,
    lineHeight: 1.6,
    color: '#1e293b',
  },
  timestamp: {
    fontSize: 8,
    color: '#94a3b8',
    textAlign: 'right',
    marginTop: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 8,
    color: '#94a3b8',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    borderTopStyle: 'solid',
    paddingTop: 8,
  },
  pageNumber: {
    position: 'absolute',
    bottom: 24,
    right: 40,
    fontSize: 8,
    color: '#94a3b8',
  },
});

interface ChatMessage {
  role: string;
  content: string;
  timestamp: string;
}

interface ChatPdfDocumentProps {
  title: string;
  model: string;
  date: string;
  messages: ChatMessage[];
}

export function ChatPdfDocument({ title, model, date, messages }: ChatPdfDocumentProps) {
  const formattedDate = new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>Model: {model}</Text>
          <Text style={styles.meta}>Date: {formattedDate}</Text>
          <Text style={styles.meta}>Messages: {messages.length}</Text>
        </View>

        {/* Messages */}
        {messages.map((msg, i) => (
          <View
            key={i}
            style={[
              styles.messageContainer,
              msg.role === 'user' ? styles.userMessage : styles.assistantMessage,
            ]}
            wrap={false}
          >
            <Text
              style={[
                styles.roleLabel,
                msg.role === 'user' ? styles.userRoleLabel : styles.assistantRoleLabel,
              ]}
            >
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </Text>
            <Text style={styles.messageContent}>{msg.content}</Text>
            <Text style={styles.timestamp}>
              {new Date(msg.timestamp).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        ))}

        {/* Footer */}
        <Text style={styles.footer} fixed>
          Exported from MultiChat AI
        </Text>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}
