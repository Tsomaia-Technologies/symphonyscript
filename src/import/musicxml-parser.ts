// =============================================================================
// SymphonyScript - MusicXML Parser (Environment-aware)
// Provides a unified XML parsing interface for Browser and Node.js
// =============================================================================

/**
 * Parsed XML Document interface.
 * This is a subset of the DOM Document interface that we need.
 */
export interface XMLDocument {
  documentElement: XMLElement
  getElementsByTagName(name: string): XMLNodeList
}

/**
 * Parsed XML Element interface.
 * This is a subset of the DOM Element interface that we need.
 */
export interface XMLElement {
  tagName: string
  textContent: string | null
  getAttribute(name: string): string | null
  getElementsByTagName(name: string): XMLNodeList
  childNodes: XMLNodeList
  children: XMLNodeList
  parentElement: XMLElement | null
}

/**
 * Node list interface for iteration.
 */
export interface XMLNodeList {
  length: number
  item(index: number): XMLElement | null
  [index: number]: XMLElement
}

// Cache for the parser
let cachedParser: ((xml: string) => XMLDocument) | null = null

/**
 * Parse an XML string into a document.
 * Uses native DOMParser in browsers, fast-xml-parser in Node.js.
 * 
 * @param xml - XML string to parse
 * @returns Parsed XML document
 * @throws Error if parsing fails or no parser is available
 */
export function parseXML(xml: string): XMLDocument {
  if (cachedParser) {
    return cachedParser(xml)
  }

  // Try browser DOMParser first
  if (typeof DOMParser !== 'undefined') {
    cachedParser = (xmlStr: string) => {
      const parser = new DOMParser()
      const doc = parser.parseFromString(xmlStr, 'application/xml')
      
      // Check for parse errors
      const parseError = doc.getElementsByTagName('parsererror')
      if (parseError.length > 0) {
        throw new Error(`XML parse error: ${parseError[0].textContent}`)
      }
      
      return doc as unknown as XMLDocument
    }
    return cachedParser(xml)
  }

  // Try Node.js - fast-xml-parser
  try {
    // Dynamic import to avoid bundling issues
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { XMLParser } = require('fast-xml-parser')
    
    cachedParser = (xmlStr: string) => {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        preserveOrder: true
      })
      const parsed = parser.parse(xmlStr)
      return wrapFastXmlResult(parsed)
    }
    return cachedParser(xml)
  } catch {
    // fast-xml-parser not available
  }

  // Try xmldom as fallback
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DOMParser: XmldomParser } = require('@xmldom/xmldom')
    
    cachedParser = (xmlStr: string) => {
      const parser = new XmldomParser()
      const doc = parser.parseFromString(xmlStr, 'application/xml')
      return doc as unknown as XMLDocument
    }
    return cachedParser(xml)
  } catch {
    // xmldom not available
  }

  throw new Error(
    'No XML parser available. ' +
    'In Node.js, install fast-xml-parser or @xmldom/xmldom: npm install fast-xml-parser'
  )
}

/**
 * Get all child elements with a specific tag name.
 */
export function getElements(parent: XMLElement | XMLDocument, tagName: string): XMLElement[] {
  const elements = parent.getElementsByTagName(tagName)
  const result: XMLElement[] = []
  for (let i = 0; i < elements.length; i++) {
    const el = elements.item(i)
    if (el) result.push(el)
  }
  return result
}

/**
 * Get the first child element with a specific tag name, or null.
 */
export function getElement(parent: XMLElement | XMLDocument, tagName: string): XMLElement | null {
  const elements = parent.getElementsByTagName(tagName)
  return elements.length > 0 ? elements.item(0) : null
}

/**
 * Get direct child elements with a specific tag name.
 */
export function getDirectChildren(parent: XMLElement, tagName: string): XMLElement[] {
  const result: XMLElement[] = []
  const children = parent.children || parent.childNodes
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child && child.tagName === tagName) {
      result.push(child)
    }
  }
  return result
}

/**
 * Get all direct child elements.
 */
export function getAllDirectChildren(parent: XMLElement): XMLElement[] {
  const result: XMLElement[] = []
  const children = parent.children || parent.childNodes
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child && child.tagName) {
      result.push(child)
    }
  }
  return result
}

/**
 * Get the text content of an element, trimmed.
 */
export function getText(el: XMLElement | null): string {
  if (!el) return ''
  return (el.textContent || '').trim()
}

/**
 * Get an attribute value from an element.
 */
export function getAttribute(el: XMLElement | null, name: string): string | null {
  if (!el) return null
  return el.getAttribute(name)
}

/**
 * Get text content of a child element by tag name.
 */
export function getChildText(parent: XMLElement, tagName: string): string {
  const child = getElement(parent, tagName)
  return getText(child)
}

/**
 * Get attribute as number, or default value.
 */
export function getAttributeNumber(el: XMLElement | null, name: string, defaultValue: number): number {
  const value = getAttribute(el, name)
  if (value === null) return defaultValue
  const num = parseFloat(value)
  return isNaN(num) ? defaultValue : num
}

/**
 * Get attribute as integer, or default value.
 */
export function getAttributeInt(el: XMLElement | null, name: string, defaultValue: number): number {
  const value = getAttribute(el, name)
  if (value === null) return defaultValue
  const num = parseInt(value, 10)
  return isNaN(num) ? defaultValue : num
}

// --- fast-xml-parser wrapper ---

/**
 * Wrap fast-xml-parser output to match DOM API.
 * fast-xml-parser with preserveOrder returns a different structure.
 */
function wrapFastXmlResult(parsed: any): XMLDocument {
  // Find the root element
  const rootArray = Array.isArray(parsed) ? parsed : [parsed]
  const root = rootArray.find((item: any) => {
    const keys = Object.keys(item).filter(k => k !== ':@')
    return keys.length > 0
  })

  if (!root) {
    throw new Error('No root element found in XML')
  }

  const rootTagName = Object.keys(root).find(k => k !== ':@') || ''
  const rootContent = root[rootTagName]

  const wrappedRoot = wrapElement(rootTagName, rootContent, root[':@'] || {})

  return {
    documentElement: wrappedRoot,
    getElementsByTagName(name: string) {
      return createNodeList(findAllByTagName(wrappedRoot, name))
    }
  }
}

function wrapElement(tagName: string, content: any, attrs: any): XMLElement {
  const children: XMLElement[] = []
  let textContent = ''

  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === 'string') {
        textContent += item
      } else if (item['#text'] !== undefined) {
        textContent += item['#text']
      } else {
        const itemKeys = Object.keys(item).filter(k => k !== ':@')
        for (const key of itemKeys) {
          const childContent = item[key]
          const childAttrs = item[':@'] || {}
          if (Array.isArray(childContent)) {
            children.push(wrapElement(key, childContent, childAttrs))
          } else {
            children.push(wrapElement(key, [childContent], childAttrs))
          }
        }
      }
    }
  } else if (typeof content === 'string') {
    textContent = content
  } else if (content && typeof content === 'object') {
    if (content['#text'] !== undefined) {
      textContent = String(content['#text'])
    }
  }

  const element: XMLElement = {
    tagName,
    textContent: textContent || null,
    getAttribute(name: string): string | null {
      const attrKey = `@_${name}`
      return attrs[attrKey] !== undefined ? String(attrs[attrKey]) : null
    },
    getElementsByTagName(name: string) {
      return createNodeList(findAllByTagName(element, name))
    },
    childNodes: createNodeList(children),
    children: createNodeList(children),
    parentElement: null
  }

  // Set parent references
  for (const child of children) {
    (child as any).parentElement = element
  }

  return element
}

function findAllByTagName(element: XMLElement, tagName: string): XMLElement[] {
  const result: XMLElement[] = []

  function search(el: XMLElement) {
    if (el.tagName === tagName) {
      result.push(el)
    }
    const children = el.children || el.childNodes
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child) search(child)
    }
  }

  // Search children, not the element itself
  const children = element.children || element.childNodes
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child) search(child)
  }

  return result
}

function createNodeList(elements: XMLElement[]): XMLNodeList {
  const list = elements as any
  list.item = (index: number) => elements[index] || null
  return list as XMLNodeList
}
