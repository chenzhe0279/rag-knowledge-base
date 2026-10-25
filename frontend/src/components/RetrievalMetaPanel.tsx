import { ChevronRightIcon, LayersIcon } from './Icons'
import {
  formatRetrievalRank,
  formatRetrievalScore,
  getRetrievalSourceKind,
  getRetrievalSourceLabel,
} from '../lib/retrieval'
import type { ChatCitation } from '../types/chat'

interface RetrievalMetaPanelProps {
  citations: ChatCitation[]
  live?: boolean
}

/**
 * assistant 消息的混合检索快照。
 * 只在后端返回了 retrieval_meta 时渲染；旧历史消息没有该字段，面板自动隐藏。
 */
export function RetrievalMetaPanel({
  citations,
  live = false,
}: RetrievalMetaPanelProps) {
  const rows = citations.filter((citation) => citation.retrieval_meta)

  if (rows.length === 0) {
    return null
  }

  const dualCount = rows.filter(
    (citation) =>
      getRetrievalSourceKind(citation.retrieval_meta) === 'hybrid',
  ).length
  const summary = `${rows.length} 条候选 · ${dualCount} 条双路命中`

  return (
    <details className="chat-route-debug chat-retrieval-debug">
      <summary className="chat-route-debug__summary">
        <span className="chat-route-debug__icon" aria-hidden="true">
          <LayersIcon />
        </span>
        <span className="chat-route-debug__heading">
          <span className="chat-route-debug__eyebrow">
            <i aria-hidden="true" />
            HYBRID RETRIEVAL · RRF
            {live ? <em>实时</em> : null}
          </span>
          <strong>混合检索快照</strong>
        </span>
        <span className="chat-route-debug__preview" title={summary}>
          {summary}
        </span>
        <span className="chat-route-debug__control">
          查看排名
          <ChevronRightIcon className="chat-route-debug__chevron" />
        </span>
      </summary>

      <div className="chat-route-debug__body">
        <div className="chat-route-debug__intro">
          <p>向量语义召回 + 关键词全文召回，按倒数排名融合（RRF，k=60）。</p>
          <span className="chat-route-debug__state">
            {live ? '正在融合' : '已随消息持久化'}
          </span>
        </div>

        <div
          className="chat-retrieval-debug__legend"
          aria-label="检索来源图例"
        >
          <span data-source="vector">向量</span>
          <span data-source="keyword">关键词</span>
          <span data-source="hybrid">双路命中</span>
        </div>

        <div className="chat-retrieval-debug__table-wrap">
          <table className="chat-retrieval-debug__table">
            <thead>
              <tr>
                <th>#</th>
                <th>文档</th>
                <th>来源</th>
                <th>向量路</th>
                <th>关键词路</th>
                <th>RRF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((citation) => {
                const meta = citation.retrieval_meta
                if (!meta) {
                  return null
                }

                const kind = getRetrievalSourceKind(meta)

                return (
                  <tr
                    key={`${citation.ordinal}-${
                      citation.chunk_id ?? citation.document_name
                    }`}
                  >
                    <td>[{citation.ordinal}]</td>
                    <td
                      className="chat-retrieval-debug__doc"
                      title={citation.document_name}
                    >
                      {citation.document_name}
                    </td>
                    <td>
                      <span
                        className={`chat-retrieval-source chat-retrieval-source--${kind}`}
                      >
                        {getRetrievalSourceLabel(kind)}
                      </span>
                    </td>
                    <td>
                      <span className="chat-retrieval-debug__rank">
                        {formatRetrievalRank(meta.vector_rank)}
                      </span>
                      <small>{formatRetrievalScore(meta.vector_score, 3)}</small>
                    </td>
                    <td>
                      <span className="chat-retrieval-debug__rank">
                        {formatRetrievalRank(meta.keyword_rank)}
                      </span>
                      <small>
                        {formatRetrievalScore(meta.keyword_score, 3)}
                      </small>
                    </td>
                    <td>
                      <span className="chat-retrieval-debug__rrf">
                        {formatRetrievalScore(meta.rrf_score, 4)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="chat-route-debug__footer">
          <span>
            <i aria-hidden="true" /> route_query → vector + keyword → rrf_fuse
          </span>
          <code>k=60</code>
        </div>
      </div>
    </details>
  )
}
