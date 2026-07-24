# Advanced Azure Diagram Templates

## Multi-region active-active

```text
Global users -> Azure Front Door (WAF)
              -> Region A: ingress -> compute -> regional data
              -> Region B: ingress -> compute -> regional data
Cosmos DB multi-region writes <-> both regions
or Azure SQL failover group: primary <-> secondary
Storage account object replication: region A <-> region B
```

Label routing priority/latency behavior and database write topology. Do not imply that Front Door moves database traffic.

## Enterprise landing zone

```text
Microsoft Entra tenant
  Tenant root management group
    Platform
      Identity subscription
      Connectivity subscription: Virtual WAN or hub VNet, Firewall, DNS
      Management subscription: Monitor, Log Analytics, automation
    Landing zones
      Corp subscriptions
      Online subscriptions
    Sandbox / Decommissioned
Azure Policy assignments flow from management groups to descendants
```

Use governance scopes for ownership/policy and network scopes for traffic.

## Hybrid connectivity

```text
On-premises data center -> ExpressRoute circuit -> gateway -> hub VNet / vWAN hub
                                                  -> spoke VNet workloads
Private DNS resolver <-> on-prem DNS
Azure Arc --control plane--> Azure Resource Manager
```

Show VPN as backup only if that relationship is stated.

## Sizing

- Small (3-5 services): 900x650
- Medium (6-12 services): 1400x900
- Large (13+ services): 1800x1200
- Multi-region or landing zone: 2200x1200 minimum
