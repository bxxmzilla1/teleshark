#include "mainwindow.h"

#include <QApplication>

int main(int argc, char *argv[]) {
    QCoreApplication::setOrganizationName(QStringLiteral("MultiGram"));
    QCoreApplication::setApplicationName(QStringLiteral("MultiGram"));

    QApplication app(argc, argv);

    MainWindow window;
    window.show();

    return app.exec();
}
