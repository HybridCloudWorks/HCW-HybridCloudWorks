# Azure2 Resource, Boundary, and Utility Patterns

Azure2 service icons are SVG images. Use plain draw.io containers for Azure scopes and resource boundaries.

## Governance boundaries

| Boundary | Style intent | Container behavior |
| --- | --- | --- |
| Microsoft Entra tenant | solid Azure blue outer scope | `container=1` |
| Management group | dashed dark-blue governance scope | `container=1` |
| Subscription | solid blue governance scope | `container=1` |
| Resource group | dashed Azure blue grouping | `container=1` |

Do not use governance boundaries to imply packet routing or isolation.

## Deployment and network boundaries

| Boundary | Style intent | Container behavior |
| --- | --- | --- |
| Azure region | teal dashed decoration | `container=0` |
| Availability zone | blue dashed scope | `container=1` |
| Virtual network | blue solid scope | `container=1` |
| Subnet | green or light-blue scope | `container=1` |
| AKS cluster | cyan dashed scope | `container=1` |
| Container Apps environment | purple dashed scope | `container=1` |

Keep resources in a decorative region as children of the nearest real parent using absolute coordinates. This prevents deep nesting from distorting orthogonal routing.

## Common resource-level icons

- Blob/container/queue/table: use `general/Blob_Block.svg`, `general/Storage_Container.svg`, `general/Storage_Queue.svg`, or `general/Table.svg` when a storage sub-service must be explicit.
- Resource group: use `general/Resource_Groups.svg` only as a service-like node; prefer a boundary for actual grouping.
- Subscription: use `general/Subscriptions.svg` only in governance maps.
- Managed identity: use `identity/Managed_Identities.svg` when identity flow is the diagram's focus; otherwise label the relationship.
- Private endpoint: use `networking/Private_Endpoint.svg` and connect it to both the subnet and service relationship without implying it is a proxy.
- Network security group: use `networking/Network_Security_Groups.svg` when rule enforcement is important; otherwise label the subnet association.
- Route table: use `networking/Route_Tables.svg` when routing intent matters.

## Image style

```text
image;aspect=fixed;html=1;points=[];align=center;verticalAlign=top;verticalLabelPosition=bottom;fontSize=10;fontFamily=Helvetica;image=img/lib/azure2/CATEGORY/ICON.svg
```

Use 48x48 icons. Keep `value` on the icon as the Azure service name plus an optional italic role. Put the functional category on the surrounding 120x120 container.

## External and generic shapes

Use built-in generic shapes for users, devices, external clouds, on-premises data centers, and third-party products. See `general-icons.md`. Labels are mandatory because generic icons do not identify a vendor or product.
