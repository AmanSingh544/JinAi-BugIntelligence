import { Module } from '@nestjs/common';
import { ClusteringQueue } from './clustering.queue';
import { ClusteringWorker } from './clustering.worker';

@Module({
  providers: [ClusteringQueue, ClusteringWorker],
  exports: [ClusteringQueue],
})
export class ClusteringModule {}
