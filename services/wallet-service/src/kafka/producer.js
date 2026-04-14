const { Kafka, logLevel, CompressionTypes } = require("kafkajs");
const logger = require("../utils/logger");

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || "wallet-service",
  brokers: (process.env.KAFKA_BROKER || "localhost:9092").split(","),
  logLevel: logLevel.WARN,
  retry: { initialRetryTime: 300, retries: 8 },
});

const producer = kafka.producer({
  idempotent: true,
  transactionTimeout: 30000,
});

let connected = false;

async function connect() {
  if (!connected) {
    await producer.connect();
    connected = true;
    logger.info("Kafka producer connected");
  }
}

async function publish(topic, payload, key = null) {
  await connect();
  await producer.send({
    topic,
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key: key ? String(key) : null,
        value: JSON.stringify({
          ...payload,
          _meta: {
            topic,
            producedAt: new Date().toISOString(),
            service: "wallet-service",
          },
        }),
      },
    ],
  });
  logger.debug("Event published", { topic, key });
}

async function disconnect() {
  if (connected) {
    await producer.disconnect();
    connected = false;
  }
}

module.exports = { publish, disconnect };
