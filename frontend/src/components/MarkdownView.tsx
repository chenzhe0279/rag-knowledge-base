import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// 外链统一新窗口打开，避免离开工作台
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
}

export function MarkdownView({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className ? `markdown ${className}` : 'markdown'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
