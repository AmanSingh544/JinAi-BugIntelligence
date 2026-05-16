import { Module } from '@nestjs/common';
import { ClusteringQueue } from './clustering.queue';
import { ClusteringWorker } from './clustering.worker';
import { ClustersController } from './clusters.controller';

@Module({
  controllers: [ClustersController],
  providers: [ClusteringQueue, ClusteringWorker],
  exports: [ClusteringQueue],
})
export class ClusteringModule {}
