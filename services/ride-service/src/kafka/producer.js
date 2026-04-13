const { Kafka, logLevel, CompressionTypes } = require("kafkajs");
const logger = require("../logger");

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || "ride-service",
  brokers: (process.env.KAFKA_BROKER || "localhost:9092").split(","),
  logLevel: logLevel.WARN,
  retry: {
    initialRetryTime: 300,
    retries: 8,
  },
});

const producer = kafka.producer({
  // Idempotent = exactly-once delivery even on retries
  idempotent: true,
  transactionTimeout: 30000,
});

let isConnected = false;

async function connect() {
  if (!isConnected) {
    await producer.connect();
    isConnected = true;
    logger.info("Kafka producer connected");
  }
}

async function publish(topic, payload, key = null) {
  await connect();

  const message = {
    key: key ? String(key) : null,
    value: JSON.stringify({
      ...payload,
      _meta: {
        topic,
        producedAt: new Date().toISOString(),
        service: "ride-service",
      },
    }),
  };

  await producer.send({
    topic,
    compression: CompressionTypes.GZIP,
    messages: [message],
  });

  logger.debug("Kafka event published", { topic, key });
}

async function disconnect() {
  if (isConnected) {
    await producer.disconnect();
    isConnected = false;
  }
}

module.exports = { publish, disconnect };
