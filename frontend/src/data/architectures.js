export const awsArchitectures = {
  'global-load-balancing': {
    title: 'Global Load Balancing',
    category: 'Networking',
    complexity: 'Level 300',
    description:
      'High-availability routing using ELB and Route 53 with multi-region failover and health checks.',
    estimatedCost: '$800 - $1,500 / month',
    overview: `
      <h2>Architecture Overview</h2>
      <p>This pattern provides global high availability for web applications by distributing traffic across multiple AWS Regions. It leverages <strong>AWS Route 53</strong> for DNS-based routing and <strong>Elastic Load Balancing (ELB)</strong> for local traffic distribution within each region.</p>
      <h3>Core Components</h3>
      <ul>
        <li><strong>Amazon Route 53:</strong> Uses Geolocation or Latency-based routing to direct users to the nearest healthy region.</li>
        <li><strong>Application Load Balancer (ALB):</strong> Terminates SSL/TLS and balances traffic across EC2 instances or containers in multiple Availability Zones.</li>
        <li><strong>AWS Global Accelerator:</strong> (Optional) Provides static IP addresses and routes traffic over the AWS global network for improved performance.</li>
      </ul>
    `,
    terraformCode: `
resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.primary.zone_id
  name    = "example.com"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
    `,
    tags: ['High Availability', 'Networking', 'Global'],
  },
  'multi-region-dr': {
    title: 'Multi-Region DR',
    category: 'Disaster Recovery',
    complexity: 'Level 400',
    description:
      'Active-Passive setup using RDS Aurora Global Database and S3 Cross-Region Replication for mission-critical apps.',
    estimatedCost: '$3,000 - $5,000 / month',
    overview: `
      <h2>Architecture Overview</h2>
      <p>A robust Disaster Recovery (DR) strategy ensuring business continuity even in the event of a full regional outage. This pattern follows an <strong>Active-Passive</strong> (Pilot Light or Warm Standby) approach.</p>
      <h3>Key Technologies</h3>
      <ul>
        <li><strong>RDS Aurora Global Database:</strong> Provides fast cross-region replication with typical latency of under 1 second.</li>
        <li><strong>S3 Cross-Region Replication (CRR):</strong> Automatically replicates objects across regions for data backup.</li>
        <li><strong>AWS CloudFormation/Terraform:</strong> Used to maintain identical infrastructure definitions across regions.</li>
      </ul>
    `,
    terraformCode: `
resource "aws_rds_global_cluster" "example" {
  global_cluster_identifier = "global-test"
  engine                    = "aurora-mysql"
  engine_version            = "5.7.mysql_aurora.2.07.2"
  database_name             = "example_db"
}
    `,
    tags: ['Disaster Recovery', 'Enterprise', 'Compliance'],
  },
  'container-orchestration': {
    title: 'Container Orchestration',
    category: 'Containers',
    complexity: 'Level 300',
    description:
      'Modern microservices deployment on ECS Fargate with automated scaling and service discovery.',
    estimatedCost: '$1,500 - $3,000 / month',
    overview: `
      <h2>Architecture Overview</h2>
      <p>Leverage <strong>Amazon ECS with AWS Fargate</strong> to run containers without managing servers. This architecture is ideal for microservices that require rapid scaling and high isolation.</p>
      <h3>Key Features</h3>
      <ul>
        <li><strong>Serverless Compute:</strong> Fargate removes the need to provision or manage EC2 instances.</li>
        <li><strong>Service Discovery:</strong> Integrated with AWS Cloud Map for microservices communication.</li>
        <li><strong>IAM Roles for Tasks:</strong> Provides granular security permissions for each container service.</li>
      </ul>
    `,
    terraformCode: `
resource "aws_ecs_service" "app" {
  name            = "my-app"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 3
  launch_type     = "FARGATE"
}
    `,
    tags: ['Containers', 'Microservices', 'Fargate'],
  },
  'serverless-api': {
    title: 'Serverless API',
    category: 'Serverless',
    complexity: 'Level 200',
    description:
      'Cost-optimized event-driven backend using Lambda, API Gateway, and DynamoDB for massive scale.',
    estimatedCost: '$0 - $500 / month (Pay-per-use)',
    overview: `
      <h2>Architecture Overview</h2>
      <p>A fully serverless API architecture that scales automatically from zero to thousands of concurrent requests. Perfect for startups and event-driven workloads.</p>
      <h3>Core Stack</h3>
      <ul>
        <li><strong>Amazon API Gateway:</strong> Handles RESTful endpoints, authentication, and throttling.</li>
        <li><strong>AWS Lambda:</strong> Executes business logic only when triggered, minimizing idle costs.</li>
        <li><strong>Amazon DynamoDB:</strong> NoSQL database providing consistent, single-digit millisecond latency at any scale.</li>
      </ul>
    `,
    terraformCode: `
resource "aws_lambda_function" "api_handler" {
  filename      = "lambda.zip"
  function_name = "api-handler"
  role          = aws_iam_role.iam_for_lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
}
    `,
    tags: ['Serverless', 'API', 'Cost-Effective'],
  },
  'data-lake': {
    title: 'Data Lake Architecture',
    category: 'Analytics',
    complexity: 'Level 300',
    description:
      'Scalable data storage and analytics pipeline using S3, Glue, and Athena for serverless queries.',
    estimatedCost: '$500 - $1,200 / month',
    overview: `
      <h2>Architecture Overview</h2>
      <p>Build a modern Data Lake on AWS to store vast amounts of raw data in its native format. This decoupled architecture allows you to scale storage and compute independently.</p>
      <h3>Workflow</h3>
      <ul>
        <li><strong>Ingestion:</strong> Data is collected in <strong>Amazon S3</strong> buckets.</li>
        <li><strong>Schema Discovery:</strong> <strong>AWS Glue Crawlers</strong> automatically discover data formats and populate the Glue Data Catalog.</li>
        <li><strong>Analysis:</strong> Use <strong>Amazon Athena</strong> to run SQL queries directly on data stored in S3.</li>
      </ul>
    `,
    terraformCode: `
resource "aws_s3_bucket" "datalake" {
  bucket = "my-company-data-lake"
}

resource "aws_glue_catalog_database" "main" {
  name = "datalake_db"
}
    `,
    tags: ['Big Data', 'Analytics', 'Data Lake'],
  },
  'hybrid-connectivity': {
    title: 'Hybrid Connectivity',
    category: 'Connectivity',
    complexity: 'Level 400',
    description:
      'Secure enterprise connection via Direct Connect and Transit Gateway for hybrid cloud workloads.',
    estimatedCost: '$2,000 - $4,000 / month',
    overview: `
      <h2>Architecture Overview</h2>
      <p>Connect your on-premises data centers to the AWS Cloud with consistent network performance and enhanced security using <strong>AWS Direct Connect</strong>.</p>
      <h3>Key Components</h3>
      <ul>
        <li><strong>Direct Connect (DX):</strong> Dedicated network connection from your premises to AWS.</li>
        <li><strong>AWS Transit Gateway:</strong> Connects thousands of VPCs and on-premises networks through a central hub.</li>
        <li><strong>Site-to-Site VPN:</strong> Used as a backup or secondary path for DX connections.</li>
      </ul>
    `,
    terraformCode: `
resource "aws_ec2_transit_gateway" "main" {
  description = "Central transit gateway"
}
    `,
    tags: ['Networking', 'Hybrid Cloud', 'Enterprise'],
  },
};
