import { useState, type FormEvent } from 'react'
import { createEvaluationRun } from '../../api/evaluations'
import { errorMessage } from '../../api/http'
import { AlertIcon, InfoIcon } from '../../components/Icons'
import { Modal } from '../../components/Modal'
import { formatNumber } from '../../lib/format'
import type { DatasetInfo, EvaluationRun } from '../../types/api'

const NAME_MAX = 256

interface CreateRunDialogProps {
  datasets: DatasetInfo[] | null
  datasetsError: string | null
  onReloadDatasets: () => void
  onClose: () => void
  onCreated: (run: EvaluationRun) => void
}

function defaultName() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `评测 ${now.getMonth() + 1}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 始终打开，由父组件按需挂载。 */
export function CreateRunDialog({
  datasets,
  datasetsError,
  onReloadDatasets,
  onClose,
  onCreated,
}: CreateRunDialogProps) {
  const [name, setName] = useState(defaultName)
  const [dataset, setDataset] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedDataset = dataset || datasets?.[0]?.name || ''
  const selectedSize = datasets?.find((item) => item.name === selectedDataset)?.size

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请填写评测名称')
      return
    }
    if (trimmed.length > NAME_MAX) {
      setError(`评测名称不能超过 ${NAME_MAX} 个字符`)
      return
    }
    if (!selectedDataset) {
      setError('请选择评测集')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const run = await createEvaluationRun(trimmed, selectedDataset)
      onCreated(run)
    } catch (caught) {
      setError(errorMessage(caught, '创建评测失败'))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      eyebrow="New evaluation run"
      title="发起评测"
      description="选择一个评测集，后端会逐条调用完整的 RAG 链路并计算 RAGAS 指标。"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="submit"
            form="create-run-form"
            className="btn btn--primary"
            disabled={busy || !datasets?.length}
          >
            {busy ? '正在创建…' : '开始评测'}
          </button>
        </>
      }
    >
      <form id="create-run-form" className="eval-form" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span className="field__label">评测名称</span>
          <input
            className="input"
            value={name}
            maxLength={NAME_MAX}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
            disabled={busy}
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field__label">评测集</span>
          {datasetsError ? (
            <div className="inline-error" role="alert">
              <span className="inline-error__text">
                <AlertIcon size={15} />
                {datasetsError}
              </span>
              <button type="button" className="btn btn--sm btn--danger-ghost" onClick={onReloadDatasets}>
                重试
              </button>
            </div>
          ) : (
            <select
              className="select"
              value={selectedDataset}
              onChange={(event) => setDataset(event.target.value)}
              disabled={busy || !datasets?.length}
            >
              {!datasets ? <option value="">正在加载评测集…</option> : null}
              {datasets && !datasets.length ? <option value="">后端没有可用的评测集</option> : null}
              {datasets?.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name} · {formatNumber(item.size)} 条
                </option>
              ))}
            </select>
          )}
          <span className="field__hint">评测集是后端 datasets 目录下的 jsonl 文件。</span>
        </label>

        <div className="inline-note">
          <InfoIcon size={15} />
          <p>
            评测在后端异步执行
            {selectedSize ? (
              <>
                ，共 <span className="num">{selectedSize}</span> 条 case
              </>
            ) : null}
            。创建后可以关闭页面，回来时进度会自动刷新。
          </p>
        </div>

        {error ? (
          <div className="inline-error" role="alert">
            <span className="inline-error__text">
              <AlertIcon size={15} />
              {error}
            </span>
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
