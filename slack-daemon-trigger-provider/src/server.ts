import express, { Request, Response, NextFunction } from 'express'
import bodyParser from 'body-parser'


// Function to start Express App
export const startServer = (port: number) => {
    const app = express()
    app.use(bodyParser.json())

    // Middleware for logging HTTP requests
    app.use((req: Request, res: Response, next: NextFunction) => {
        console.log('--- Incoming HTTP Request ---')
        console.log(`Method: ${req.method}`)
        console.log(`URL: ${req.url}`)
        console.log('Headers:', req.headers)
        console.log('Body:', JSON.stringify(req.body, null, 2))
        console.log('--------------------------------')
        next()
    })

    // Health check endpoint
    app.get('/', (_req: Request, res: Response) => res.send('OK'))

    // Catch-all route for logging all POST requests
    app.post('/*', (req: Request, res: Response) => {
        console.log('POST Request:', req.body)
        res.send('OK')
    })

    return app.listen(port, '127.0.0.1', () => {
        console.log(`Server is listening on port ${port}`)
    })
}
