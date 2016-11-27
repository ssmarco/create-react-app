(function() {
  const ErrorStackParser = require('error-stack-parser')
  const StackTraceGPS = require('stacktrace-gps')
  const gps = new StackTraceGPS()

  const overlayStyle = {
    position: 'fixed',
    'box-sizing': 'border-box',
    top: '0px', left: '0px',
    bottom: '0px', right: '0px',
    width: '100vw', height: '100vh',
    'background-color': 'rgb(200, 0, 0)',
    padding: '2rem',
    'z-index': 1337,
    'font-family': 'Menlo, Consolas, monospace',
    color: 'rgb(232, 232, 232)',
    'white-space': 'pre-wrap',
    overflow: 'auto'
  }

  const headerStyle = {
    'font-size': 'larger',
    'font-weight': 'bold'
  }

  const traceStyle = {
    'font-size': '1rem'
  }

  function applyStyles(element, styles) {
    element.setAttribute('style', '')
    for (const key in styles) {
      if (!styles.hasOwnProperty(key)) continue
      element.style[key] = styles[key].toString()
    }
  }

  let overlayReference = null

  function render(name, message, frames) {
    if (overlayReference !== null) unmount()
    // Create container
    const overlay = document.createElement('div')
    applyStyles(overlay, overlayStyle)

    // Create header
    const header = document.createElement('div')
    applyStyles(header, headerStyle)
    header.appendChild(document.createTextNode(`${name}: ${message}`))
    overlay.appendChild(header)

    // Show trace
    const trace = document.createElement('div')
    applyStyles(trace, traceStyle)
    for (const frame of frames) {
      const { functionName, fileName, lineNumber } = frame
      const { source } = frame
      const elem = document.createElement('div')

      // If source is available, use that (directly from browser) ...
      if (source != null) {
        elem.appendChild(document.createTextNode(`\t${source.trim()}`))
      } else {
        // We need to construct our own source since it wasn't given to us
        // This StackFrame is most likely from sourcemaps which means
        //  column numbers aren't available ... so let's only show line numbers.
        if (functionName != null) {
          elem.appendChild(document.createTextNode(`\tat ${functionName} (${fileName}:${lineNumber})`))
        } else {
          elem.appendChild(document.createTextNode(`\tat ${fileName}:${lineNumber}`))
        }
      }
      trace.appendChild(elem)
    }
    overlay.appendChild(trace)

    // Mount
    document.body.appendChild(overlayReference = overlay)
  }

  function unmount() {
    if (overlayReference === null) return
    document.body.removeChild(overlayReference)
    overlayReference = null
  }

  function crash(error, unhandledRejection = false) {
    new Promise(function(resolve, reject) {
      let frames = []

      // Wrap all this up to make sure we have a fail case (external apis) ...
      try {
        // Error -> StackFrame[]
        frames = ErrorStackParser.parse(error)
        if (frames.length === 0) {
          resolve(frames)
          return
        }

        // Resolve StackFrames via sourcemaps and magic
        const frames2 = []
        let pending = frames.length
        frames.forEach(function(frame, index) {
          gps.pinpoint(frame).then(function(nFrame) {
            frames2[index] = nFrame
            if (--pending === 0) resolve(frames2)
          }).catch(function() {
            // Failed to pinpoint frame ... reuse old frame.
            frames2[index] = frame
            if (--pending === 0) resolve(frames2)
          })
        })
      } catch (e) {
        // Failed to resolve frames at one point or another (synchronous)
        // Default to using `frames` which should contain the browser's stack
        resolve(frames)
      }
    }).then(function(frames) {
      if (unhandledRejection) {
        render(`Unhandled Rejection (${error.name})`, error.message, frames)
      } else {
        render(error.name, error.message, frames)
      }
    }).catch(function() {
      // This is another fail case (unlikely to happen)
      // e.g. render(...) throws an error with provided arguments
      render('Error', 'Unknown Error (failure to materialize)', [])
    })
  }

  window.onerror = function(messageOrEvent, source, lineno, colno, error) {
    if (error == null || !(error instanceof Error) || messageOrEvent.indexOf('Script error') !== -1) {
      crash(new Error(error || messageOrEvent))// TODO: more helpful message
    } else {
      crash(error)
    }
  }

  let promiseHandler = function(event) {
    if (event != null && event.reason != null) {
      const { reason } = event
      if (reason == null || !(reason instanceof Error)) {
        crash(new Error(reason), true)
      } else {
        crash(reason, true)
      }
    } else {
      crash(new Error('Unknown event'), true)
    }
  }

  window.addEventListener('unhandledrejection', promiseHandler)

  let escapeHandler = function(event) {
    const { key, keyCode, which } = event
    if (key === 'Escape' || keyCode === 27 === which === 27) unmount()
  }

  window.addEventListener('keydown', escapeHandler)

  if (module.hot) {
    module.hot.dispose(function() {
      unmount()
      window.removeEventListener('unhandledrejection', promiseHandler)
      window.removeEventListener('keydown', escapeHandler)
    })
  }
})()
