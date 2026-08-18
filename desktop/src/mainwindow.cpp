#include "mainwindow.h"

#include <QAction>
#include <QCloseEvent>
#include <QDesktopServices>
#include <QDir>
#include <QFileDialog>
#include <QFileInfo>
#include <QInputDialog>
#include <QMenu>
#include <QMenuBar>
#include <QMessageBox>
#include <QSettings>
#include <QStandardPaths>
#include <QWebEngineDownloadRequest>
#include <QWebEngineFullScreenRequest>
#include <QWebEngineNewWindowRequest>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QWebEngineView>

MainWindow::MainWindow(QWidget *parent) : QMainWindow(parent) {
    setWindowTitle(QStringLiteral("MultiGram"));
    setWindowIcon(QIcon(QStringLiteral(":/icon.svg")));

    // A named profile is persistent: cookies (the app-password login) and
    // IndexedDB (the vault) are kept under AppData between launches.
    m_profile = new QWebEngineProfile(QStringLiteral("MultiGram"), this);
    m_profile->setPersistentCookiesPolicy(
        QWebEngineProfile::ForcePersistentCookies);

    auto *page = new QWebEnginePage(m_profile, this);
    m_view = new QWebEngineView(this);
    m_view->setPage(page);
    setCentralWidget(m_view);

    auto *settings = page->settings();
    settings->setAttribute(QWebEngineSettings::FullScreenSupportEnabled, true);
    settings->setAttribute(QWebEngineSettings::LocalStorageEnabled, true);
    settings->setAttribute(QWebEngineSettings::JavascriptCanOpenWindows, true);

    // Links that would open a new tab/window go to the system browser
    // (e.g. clickable links inside chat messages).
    connect(page, &QWebEnginePage::newWindowRequested, this,
            [](QWebEngineNewWindowRequest &request) {
                QDesktopServices::openUrl(request.requestedUrl());
            });

    // Videos can go fullscreen inside the window.
    connect(page, &QWebEnginePage::fullScreenRequested, this,
            [this](QWebEngineFullScreenRequest request) {
                request.accept();
                if (request.toggleOn()) {
                    menuBar()->hide();
                    showFullScreen();
                } else {
                    menuBar()->show();
                    showNormal();
                }
            });

    // Vault "Download" buttons and media downloads.
    connect(m_profile, &QWebEngineProfile::downloadRequested, this,
            &MainWindow::handleDownload);

    buildMenu();

    QSettings s;
    restoreGeometry(s.value(QStringLiteral("geometry")).toByteArray());
    if (!s.contains(QStringLiteral("geometry"))) {
        resize(1280, 840);
    }

    loadAppUrl();
}

QString MainWindow::appUrl() const {
    return QSettings().value(QStringLiteral("appUrl")).toString().trimmed();
}

void MainWindow::loadAppUrl() {
    const QString url = appUrl();
    if (url.isEmpty()) {
        promptForUrl();
        return;
    }
    m_view->load(QUrl(url));
}

void MainWindow::promptForUrl() {
    bool ok = false;
    const QString entered = QInputDialog::getText(
        this, QStringLiteral("MultiGram"),
        QStringLiteral("Enter your MultiGram URL\n"
                       "(your Vercel deployment, e.g. "
                       "https://your-app.vercel.app):"),
        QLineEdit::Normal, appUrl(), &ok);
    if (!ok) {
        if (appUrl().isEmpty()) {
            QMessageBox::information(
                this, QStringLiteral("MultiGram"),
                QStringLiteral("No URL set yet — use App > Set app URL to "
                               "connect to your deployment."));
        }
        return;
    }
    QString url = entered.trimmed();
    if (url.isEmpty()) return;
    if (!url.startsWith(QStringLiteral("http://")) &&
        !url.startsWith(QStringLiteral("https://"))) {
        url.prepend(QStringLiteral("https://"));
    }
    QSettings().setValue(QStringLiteral("appUrl"), url);
    m_view->load(QUrl(url));
}

void MainWindow::handleDownload(QWebEngineDownloadRequest *download) {
    const QString suggested =
        QDir(QStandardPaths::writableLocation(
                 QStandardPaths::DownloadLocation))
            .filePath(download->downloadFileName());
    const QString path = QFileDialog::getSaveFileName(
        this, QStringLiteral("Save file"), suggested);
    if (path.isEmpty()) {
        download->cancel();
        return;
    }
    const QFileInfo info(path);
    download->setDownloadDirectory(info.absolutePath());
    download->setDownloadFileName(info.fileName());
    download->accept();
}

void MainWindow::buildMenu() {
    QMenu *appMenu = menuBar()->addMenu(QStringLiteral("&App"));

    QAction *setUrl = appMenu->addAction(QStringLiteral("Set app &URL…"));
    connect(setUrl, &QAction::triggered, this, &MainWindow::promptForUrl);

    QAction *reload = appMenu->addAction(QStringLiteral("&Reload"));
    reload->setShortcut(QKeySequence::Refresh);
    connect(reload, &QAction::triggered, m_view, &QWebEngineView::reload);

    appMenu->addSeparator();

    QAction *zoomIn = appMenu->addAction(QStringLiteral("Zoom &In"));
    zoomIn->setShortcut(QKeySequence::ZoomIn);
    connect(zoomIn, &QAction::triggered, this,
            [this] { m_view->setZoomFactor(m_view->zoomFactor() + 0.1); });

    QAction *zoomOut = appMenu->addAction(QStringLiteral("Zoom &Out"));
    zoomOut->setShortcut(QKeySequence::ZoomOut);
    connect(zoomOut, &QAction::triggered, this,
            [this] { m_view->setZoomFactor(m_view->zoomFactor() - 0.1); });

    QAction *zoomReset = appMenu->addAction(QStringLiteral("Reset &Zoom"));
    zoomReset->setShortcut(QKeySequence(QStringLiteral("Ctrl+0")));
    connect(zoomReset, &QAction::triggered, this,
            [this] { m_view->setZoomFactor(1.0); });

    appMenu->addSeparator();

    QAction *quit = appMenu->addAction(QStringLiteral("&Quit"));
    quit->setShortcut(QKeySequence::Quit);
    connect(quit, &QAction::triggered, this, &QWidget::close);
}

void MainWindow::closeEvent(QCloseEvent *event) {
    QSettings().setValue(QStringLiteral("geometry"), saveGeometry());
    QMainWindow::closeEvent(event);
}
