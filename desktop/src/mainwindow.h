#pragma once

#include <QMainWindow>

class QWebEngineView;
class QWebEngineProfile;
class QWebEngineDownloadRequest;

/**
 * Native desktop shell for MultiGram: a QMainWindow hosting a persistent
 * Chromium view of the deployed web app. Cookies and local storage survive
 * restarts, so the app-password login and vault stay in place.
 */
class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

protected:
    void closeEvent(QCloseEvent *event) override;

private slots:
    void promptForUrl();
    void handleDownload(QWebEngineDownloadRequest *download);

private:
    void buildMenu();
    void loadAppUrl();
    QString appUrl() const;

    QWebEngineView *m_view = nullptr;
    QWebEngineProfile *m_profile = nullptr;
};
