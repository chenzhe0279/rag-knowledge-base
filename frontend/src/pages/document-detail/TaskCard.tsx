import { ClockIcon, LayersIcon } from '../../components/Icons'
import { ProgressBar } from '../../components/ProgressBar'
import { TaskStatusBadge } from '../../components/StatusBadge'
import { isTaskActive, TASK_TYPE_LABEL } from '../../lib/documents'
import { formatDateTime, formatDuration, percentOf, shortId } from '../../lib/format'
import type { IngestionTask } from '../../types/api'

/** 最近一次 Celery 任务；进度只展示后端真实回报的 done/total，不做模拟。 */
export function TaskCard({ task }: { task: IngestionTask | null | undefined }) {
  if (!task) {
    return (
      <section className="soft-card task-card" aria-label="最近任务">
        <div className="task-card__head">
          <span className="eyebrow">Celery task</span>
        </div>
        <p className="muted task-card__empty">
          <LayersIcon size={16} />
          该文档暂无任务记录（早期入库的文档不会记录任务）。
        </p>
      </section>
    )
  }

  const hasTotal = task.progress_total > 0
  const percent = hasTotal ? percentOf(task.progress_done, task.progress_total) : null

  return (
    <section className="soft-card task-card" aria-label="最近任务">
      <div className="task-card__head">
        <div>
          <span className="eyebrow">Celery task</span>
          <h2 className="task-card__title">{TASK_TYPE_LABEL[task.task_type]}</h2>
        </div>
        <TaskStatusBadge status={task.status} />
      </div>

      <div className="task-card__progress">
        <div className="task-card__progress-text">
          <span className="num">
            {hasTotal ? `${task.progress_done} / ${task.progress_total}` : '— / —'}
          </span>
          <strong className="num">{percent === null ? '—' : `${percent}%`}</strong>
        </div>
        <ProgressBar
          value={task.status === 'pending' ? null : task.status === 'success' ? 100 : percent ?? 0}
          label={`${TASK_TYPE_LABEL[task.task_type]}进度`}
        />
      </div>

      {task.status === 'pending' ? (
        <p className="inline-note">
          <ClockIcon size={15} />
          任务已入队，等待 Worker 领取。如果长时间没有变化，请确认 Celery Worker 已启动。
        </p>
      ) : null}

      {task.status === 'failed' && task.error_message ? (
        <p className="task-card__error">{task.error_message}</p>
      ) : null}

      <dl className="facts task-card__facts">
        <div>
          <dt>任务 ID</dt>
          <dd className="mono" title={task.id}>
            {shortId(task.id)}
          </dd>
        </div>
        <div>
          <dt>重试次数</dt>
          <dd className="num">{task.retry_count}</dd>
        </div>
        <div>
          <dt>开始时间</dt>
          <dd>{formatDateTime(task.started_at)}</dd>
        </div>
        <div>
          <dt>结束时间</dt>
          <dd>{isTaskActive(task) ? '进行中' : formatDateTime(task.finished_at)}</dd>
        </div>
        <div>
          <dt>耗时</dt>
          <dd className="num">{formatDuration(task.started_at, task.finished_at)}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{formatDateTime(task.created_at)}</dd>
        </div>
      </dl>
    </section>
  )
}
