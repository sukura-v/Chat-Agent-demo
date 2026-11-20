function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function inlineMarkdown(value) {
  let html = escapeHtml(value)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  return html
}

function splitTableRow(line) {
  const content = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return content.split('|').map(cell => cell.trim())
}

function isTableDivider(line) {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

function tableAlignment(cell) {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return 'left'
}

function renderTable(lines, startIndex) {
  const headers = splitTableRow(lines[startIndex])
  const divider = splitTableRow(lines[startIndex + 1])
  const alignments = divider.map(tableAlignment)
  const rows = []
  let nextIndex = startIndex + 2

  while (nextIndex < lines.length && lines[nextIndex].includes('|') && lines[nextIndex].trim()) {
    rows.push(splitTableRow(lines[nextIndex]))
    nextIndex += 1
  }

  const headerHtml = headers.map((header, index) => (
    `<th class="markdown-align-${alignments[index] || 'left'}">${inlineMarkdown(header)}</th>`
  )).join('')
  const bodyHtml = rows.map(row => {
    const cells = headers.map((_, index) => (
      `<td class="markdown-align-${alignments[index] || 'left'}">${inlineMarkdown(row[index] || '')}</td>`
    )).join('')
    return `<tr>${cells}</tr>`
  }).join('')

  return {
    html: `<div class="markdown-table-scroll"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`,
    nextIndex,
  }
}

export function renderSafeMarkdown(value) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n')
  const output = []
  let listType = ''
  let paragraphLines = []

  const closeList = () => {
    if (!listType) return
    output.push(`</${listType}>`)
    listType = ''
  }

  const closeParagraph = () => {
    if (!paragraphLines.length) return
    output.push(`<p>${paragraphLines.join('<br>')}</p>`)
    paragraphLines = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const unordered = line.match(/^\s*[-*]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    const nextListType = unordered ? 'ul' : ordered ? 'ol' : ''
    if (nextListType) {
      closeParagraph()
      if (listType !== nextListType) {
        closeList()
        listType = nextListType
        output.push(`<${listType}>`)
      }
      output.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`)
      continue
    }
    closeList()

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      closeParagraph()
      const level = heading[1].length
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    if (
      line.includes('|')
      && index + 1 < lines.length
      && isTableDivider(lines[index + 1])
    ) {
      closeParagraph()
      const table = renderTable(lines, index)
      output.push(table.html)
      index = table.nextIndex - 1
      continue
    }

    if (!line.trim()) {
      closeParagraph()
    } else {
      paragraphLines.push(inlineMarkdown(line))
    }
  }
  closeList()
  closeParagraph()
  return output.join('')
}
