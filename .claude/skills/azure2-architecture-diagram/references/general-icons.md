# General Architecture Icons

Use built-in generic draw.io shapes for non-Azure systems. Keep the same 120x120 category container and make the label explicit.

| Technology | Suggested shape/style | Category |
| --- | --- | --- |
| PostgreSQL, MySQL, MongoDB, Redis | `shape=cylinder3` | Data |
| Docker, Kubernetes, VM, server | `rounded=1` plus clear label | Compute |
| GitHub, GitLab, external API, CDN | `shape=cloud` or labeled rectangle | External/network |
| Kafka, RabbitMQ, NATS, MQTT | labeled queue/rectangle | Integration |
| OpenAI, Anthropic, Hugging Face | labeled rounded rectangle | AI |
| HashiCorp Vault, Keycloak | labeled shield/rectangle | Security |
| Prometheus, Grafana, Datadog | labeled rounded rectangle | Operations |
| End users | `shape=mxgraph.basic.user` or labeled actor container | External actor |
| On-premises data center | labeled container with server shapes | External boundary |

Do not use an Azure icon for a third-party or on-premises product. In mixed-cloud diagrams, label every cloud boundary and avoid provider-colored connectors as the only signal.
