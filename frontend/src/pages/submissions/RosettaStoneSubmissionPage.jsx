import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function RosettaStoneSubmissionPage() {
  const mappings = [
    {
      concept: 'Virtual Machine',
      aws: 'EC2',
      azure: 'Virtual Machine',
      gcp: 'Compute Engine',
    },
    {
      concept: 'Container Orchestration',
      aws: 'ECS/EKS',
      azure: 'AKS',
      gcp: 'GKE',
    },
    {
      concept: 'Serverless Compute',
      aws: 'Lambda',
      azure: 'Functions',
      gcp: 'Cloud Functions',
    },
    {
      concept: 'Object Storage',
      aws: 'S3',
      azure: 'Blob Storage',
      gcp: 'Cloud Storage',
    },
    {
      concept: 'Relational Database',
      aws: 'RDS',
      azure: 'Azure SQL',
      gcp: 'Cloud SQL',
    },
    {
      concept: 'Key-Value Store',
      aws: 'DynamoDB',
      azure: 'Cosmos DB',
      gcp: 'Datastore',
    },
    {
      concept: 'Message Queue',
      aws: 'SQS/SNS',
      azure: 'Queue Storage/Service Bus',
      gcp: 'Pub/Sub',
    },
    {
      concept: 'Data Warehouse',
      aws: 'Redshift',
      azure: 'Azure Synapse',
      gcp: 'BigQuery',
    },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      <Helmet>
        <title>Cloud Rosetta Stone | HCW</title>
        <meta name="description" content="Multi-cloud service mapping and terminology guide" />
      </Helmet>

      <div className="mb-12">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-foreground mb-4">
          Cloud Rosetta Stone
        </h1>
        <p className="text-muted-foreground text-base sm:text-lg max-w-3xl">
          Multi-cloud service mappings to understand equivalent capabilities across AWS, Azure, and
          GCP.
        </p>
      </div>

      <div className="space-y-4 mb-16">
        {mappings.map((mapping, i) => (
          <Card key={i} className="bg-card/40 hover:bg-card/60 transition-colors">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <CardTitle className="text-base font-semibold">{mapping.concept}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="flex items-center gap-3">
                  <Badge className="bg-orange-500/20 text-orange-800 dark:text-orange-300">
                    AWS
                  </Badge>
                  <span className="text-sm font-mono text-foreground">{mapping.aws}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300">Azure</Badge>
                  <span className="text-sm font-mono text-foreground">{mapping.azure}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className="bg-red-500/20 text-red-700 dark:text-red-300">GCP</Badge>
                  <span className="text-sm font-mono text-foreground">{mapping.gcp}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="bg-card/30">
          <CardHeader>
            <CardTitle className="text-lg">Service Equivalence</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Find equivalent services across cloud providers for architecture decisions.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/30">
          <CardHeader>
            <CardTitle className="text-lg">Migration Mapping</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Plan multi-cloud migrations with clear service-to-service correlations.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/30">
          <CardHeader>
            <CardTitle className="text-lg">Learning Reference</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Understand cloud platforms by comparing familiar concepts across providers.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
