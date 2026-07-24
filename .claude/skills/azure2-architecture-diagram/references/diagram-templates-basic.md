# Basic Azure Diagram Templates

## Serverless web application

```text
Users -> Front Door (WAF) -> Static Web Apps or Storage static site
                         -> API Management -> Functions -> Cosmos DB
Microsoft Entra ID --------------------------^ authentication
Functions -> Service Bus / Event Grid for asynchronous work
```

## VNet with public and private subnets

```text
Subscription
  Resource group
    Region
      VNet 10.0.0.0/16
        ingress subnet: Application Gateway WAF
        workload subnet: VMSS, AKS, or App Service Environment
        data subnet: private endpoints
        AzureFirewallSubnet: Azure Firewall (when required)
Users -> Front Door or public IP -> Application Gateway -> workload
Workload -> private endpoint -> PaaS data service
```

Do not place NAT Gateway inline as an inbound hop. Associate it with outbound subnets.

## AKS microservices

```text
DNS / Front Door -> Application Gateway or ingress -> AKS services
ACR --deployment--> AKS
AKS -> Key Vault through workload identity
AKS -> Cosmos DB / Azure SQL through private endpoint
AKS -> Azure Monitor and Log Analytics
```

## Data and analytics

```text
Sources -> Event Hubs (stream) or Data Factory (batch)
        -> ADLS Gen2 raw -> Databricks / Synapse -> curated data
        -> Power BI or downstream APIs
Microsoft Purview governs catalog and lineage when in scope
```

## CI/CD

```text
Developer -> GitHub or Azure Repos -> GitHub Actions or Azure Pipelines
Pipeline --workload identity federation--> Azure Resource Manager
Pipeline -> ACR -> AKS / Container Apps / App Service
```

Show approval gates as process annotations, not Azure service icons.
