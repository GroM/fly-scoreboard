#pragma once

#include <QDialog>
#include <QKeySequence>
#include <QString>
#include <QVector>

class QKeySequenceEdit;
class QPushButton;
class QStackedWidget;

struct FlyHotkeyBinding {
	QString actionId;
	QString label;
	QKeySequence sequence;
};

class FlyHotkeysDialog : public QDialog {
	Q_OBJECT
public:
	explicit FlyHotkeysDialog(const QVector<FlyHotkeyBinding> &initial, QWidget *parent = nullptr);

	QVector<FlyHotkeyBinding> bindings() const;

signals:
	void bindingsChanged(const QVector<FlyHotkeyBinding> &bindings);

private slots:
	void onAccept();
	void onShowScoreboard();
	void onShowFields();
	void onShowTimers();

private:
	struct RowWidgets {
		QString actionId;
		QString label;
		QKeySequenceEdit *edit = nullptr;
		int section = 0;
	};

	void buildUi(const QVector<FlyHotkeyBinding> &initial);
	QWidget *createSectionPage(const QString &title, const QVector<FlyHotkeyBinding> &items, int sectionIndex);

	void setActiveSectionButton(int index);

	QVector<RowWidgets> rows_;
	QStackedWidget *stack_ = nullptr;
	QPushButton *btnNavScore_ = nullptr;
	QPushButton *btnNavFields_ = nullptr;
	QPushButton *btnNavTimers_ = nullptr;
	QPushButton *btnResetAll_ = nullptr;
};

QVector<FlyHotkeyBinding> fly_hotkeys_load(const QString &dataDir);
bool fly_hotkeys_save(const QString &dataDir, const QVector<FlyHotkeyBinding> &bindings);
