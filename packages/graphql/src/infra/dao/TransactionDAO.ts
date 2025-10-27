import { isB256 } from 'fuels';
import { TransactionEntity } from '~/domain/Transaction/TransactionEntity';
import { DatabaseConnectionReplica } from '../database/DatabaseConnectionReplica';
import type PaginatedParams from '../paginator/PaginatedParams';

export default class TransactionDAO {
  databaseConnection: DatabaseConnectionReplica;

  constructor() {
    this.databaseConnection = DatabaseConnectionReplica.getInstance();
  }

  async getByHash(txHash: string) {
    const transactionData = (
      await this.databaseConnection.query(
        `
		  select
			  t.*
		  from
			  indexer.transactions t
		  where
			  t.tx_hash = $1
		  `,
        [txHash.toLowerCase()],
      )
    )[0];
    if (!transactionData) return;
    return TransactionEntity.createFromDAO(transactionData);
  }

  async getPaginatedTransactionsByOwner(
    accountHash: string,
    paginatedParams: PaginatedParams,
  ) {
    const direction = paginatedParams.direction === 'before' ? '<' : '>';
    const order = paginatedParams.direction === 'before' ? 'desc' : 'asc';

    const [transactionsData, totalCount] =
      await this.databaseConnection.batchQueryWithSettings(
        [
          { name: 'enable_indexscan', value: 'off' },
          { name: 'enable_bitmapscan', value: 'on' },
        ],
        [
          {
            statement: `
              select t.*, ta._id as ta_id
              from indexer.transactions_accounts ta
              inner join indexer.transactions t on t.tx_hash = ta.tx_hash
              where ta.account_hash = $1 and ($2::text is null or ta._id ${direction} $2)
              order by ta._id ${order}
              limit 10
            `,
            params: [accountHash.toLowerCase(), paginatedParams.cursor],
          },
          {
            statement:
              'select count(*)::integer as count from indexer.transactions_accounts where account_hash = $1',
            params: [accountHash.toLowerCase()],
          },
        ],
      );

    transactionsData.sort((a: any, b: any) => {
      return a._id.localeCompare(b._id) * -1;
    });
    const transactions = [];
    for (const transactionData of transactionsData) {
      transactions.push(TransactionEntity.createFromDAO(transactionData));
    }
    if (transactions.length === 0) {
      return {
        nodes: [],
        edges: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          endCursor: '',
          startCursor: '',
        },
      };
    }

    const startCursor = transactionsData[0]._id;
    const endCursor = transactionsData[transactionsData.length - 1]._id;

    const [paginationInfo] = await this.databaseConnection.query(
      `
        select
          exists(select 1 from indexer.transactions_accounts where account_hash = $1 and _id < $2 limit 1) as has_prev,
          exists(select 1 from indexer.transactions_accounts where account_hash = $1 and _id > $3 limit 1) as has_next,
          (select count(*)::integer from indexer.transactions_accounts where account_hash = $1 and _id > $3) as count
        `,
      [accountHash.toLowerCase(), endCursor, startCursor],
    );

    const hasPreviousPage = paginationInfo?.has_prev || false;
    const hasNextPage = paginationInfo?.has_next || false;
    const newNodes = transactions.map((n) => n.toGQLListNode());

    const edges = newNodes.map((node) => ({
      node,
      cursor: paginatedParams.cursor,
    }));
    const paginatedResults = {
      nodes: newNodes,
      edges,
      pageInfo: {
        startCount: (paginationInfo?.count || 0) + 1,
        endCount: (paginationInfo?.count || 0) + paginatedParams.last,
        totalCount: totalCount[0]?.count || 0,
        hasNextPage,
        hasPreviousPage,
        endCursor,
        startCursor,
      },
    };
    return paginatedResults;
  }

  async getPaginatedTransactions(paginatedParams: PaginatedParams) {
    const direction = paginatedParams.direction === 'before' ? '<' : '>';
    const order = paginatedParams.direction === 'before' ? 'desc' : 'asc';
    const transactionsData = await this.databaseConnection.query(
      `
		select 
			*
		from 
			indexer.transactions t
		where
			$1::text is null or t._id ${direction} $1
		order by
			t._id ${order} 
		limit $2
	`,
      [paginatedParams.cursor, paginatedParams.last],
    );
    transactionsData.sort((a: any, b: any) => {
      return a._id.localeCompare(b._id) * -1;
    });
    const transactions = [];
    for (const transactionData of transactionsData) {
      transactions.push(TransactionEntity.createFromDAO(transactionData));
    }
    if (transactions.length === 0) {
      return {
        nodes: [],
        edges: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          endCursor: '',
          startCursor: '',
        },
      };
    }
    const startCursor = transactionsData[0]._id;
    const endCursor = transactionsData[transactionsData.length - 1]._id;
    const hasPreviousPage = (
      await this.databaseConnection.query(
        'select exists(select 1 from indexer.transactions where _id < $1)',
        [endCursor],
      )
    )[0].exists;
    const hasNextPage = (
      await this.databaseConnection.query(
        'select exists(select 1 from indexer.transactions where _id > $1)',
        [startCursor],
      )
    )[0].exists;
    const newNodes = transactions.map((n) => n.toGQLListNode());

    const edges = newNodes.map((node) => ({
      node,
      cursor: paginatedParams.cursor,
    }));
    const paginatedResults = {
      nodes: newNodes,
      edges,
      pageInfo: {
        hasNextPage,
        hasPreviousPage,
        endCursor,
        startCursor,
      },
    };
    return paginatedResults;
  }

  async getTransactionsByOwner(accountHash: string) {
    const transactionsData = await this.databaseConnection.query(
      `
		select
			t.*
		from
			indexer.transactions t
		inner join (
			select distinct on (tx_hash)
				tx_hash, _id as account_id
			from
				indexer.transactions_accounts
			where
				account_hash = $1
			order by
				tx_hash, _id desc
		) ta on t.tx_hash = ta.tx_hash
		order by
			ta.account_id desc
		limit 5
		`,
      [accountHash.toLowerCase()],
    );
    const transactions = [];
    for (const transactionData of transactionsData) {
      transactions.push(TransactionEntity.createFromDAO(transactionData));
    }
    return transactions;
  }

  async getPaginatedTransactionsByBlockId(
    blockId: string,
    paginatedParams: PaginatedParams,
  ) {
    let height = blockId;
    if (isB256(blockId)) {
      const [block] = await this.databaseConnection.query(
        `
			select
				b._id
			from
				indexer.blocks b
			where
				b.id = $1
		`,
        [blockId],
      );
      height = block._id;
    }
    const direction = paginatedParams.direction === 'before' ? '<' : '>';
    const order = paginatedParams.direction === 'before' ? 'desc' : 'asc';
    const transactionsData = await this.databaseConnection.query(
      `
		select
			t.*
		from
			indexer.transactions t
		where
			t.block_id = $1 and
			($2::text is null or t._id ${direction} $2)
		order by
			t._id ${order}
		limit
			10
		`,
      [height, paginatedParams.cursor],
    );
    transactionsData.sort((a: any, b: any) => {
      return a._id.localeCompare(b._id) * -1;
    });
    const transactions = [];
    for (const transactionData of transactionsData) {
      transactions.push(TransactionEntity.createFromDAO(transactionData));
    }
    if (transactions.length === 0) {
      return {
        nodes: [],
        edges: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          endCursor: '',
          startCursor: '',
        },
      };
    }
    const startCursor = transactionsData[0]._id;
    const endCursor = transactionsData[transactionsData.length - 1]._id;
    const hasPreviousPage = (
      await this.databaseConnection.query(
        'select exists(select 1 from indexer.transactions t where t._id < $1 and t.block_id = $2)',
        [endCursor, height],
      )
    )[0].exists;
    const hasNextPage = (
      await this.databaseConnection.query(
        'select exists(select 1 from indexer.transactions t where t._id > $1 and t.block_id = $2)',
        [startCursor, height],
      )
    )[0].exists;
    const [previousRows] = await this.databaseConnection.query(
      'select count(*)::integer as count from indexer.transactions where _id > $1 and block_id = $2',
      [startCursor, height],
    );
    const [totalCount] = await this.databaseConnection.query(
      'select count(*)::integer as count from indexer.transactions where block_id = $1',
      [height],
    );
    const newNodes = transactions.map((n) => n.toGQLListNode());

    const edges = newNodes.map((node) => ({
      node,
      cursor: paginatedParams.cursor,
    }));
    const paginatedResults = {
      nodes: newNodes,
      edges,
      pageInfo: {
        startCount: previousRows.count + 1,
        endCount: previousRows.count + paginatedParams.last,
        totalCount: totalCount.count,
        hasNextPage,
        hasPreviousPage,
        endCursor,
        startCursor,
      },
    };

    return paginatedResults;
  }
}
